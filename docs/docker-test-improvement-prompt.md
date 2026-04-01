# ProctorWorks (Project 104) - Docker & Testing Infrastructure Improvements

## Current State Analysis

**Project**: ProctorWorks Offline Operations Platform (NestJS + TypeORM + PostgreSQL)  
**Issues Identified**:

1. ❌ **Manual Docker Management**: Users must manually start `docker compose up` before testing
2. ❌ **No Health Check Integration**: Tests don't verify API readiness before running
3. ❌ **Missing Test Database Isolation**: Tests run against main database without proper cleanup
4. ❌ **Incomplete Test Coverage**: Missing comprehensive API endpoint testing
5. ❌ **No Self-Contained Testing**: Unlike project 17, tests don't auto-manage Docker lifecycle
6. ❌ **Missing Demo Data**: No seeded data for immediate API testing and demonstration

## Comparison with Project 17 (ParkOps)

**Project 17 Advantages**:
- ✅ **Auto Docker Management**: `run_tests.sh` starts containers if not running
- ✅ **Health Check Integration**: Waits for app readiness before testing
- ✅ **Self-Contained**: Complete test environment in one command
- ✅ **Demo Data**: Seeded admin user for immediate testing
- ✅ **Clean Architecture**: Clear separation of unit and API tests

## Required Improvements

### 1. Enhanced Docker Configuration

#### A. Update `docker-compose.yml`
```yaml
services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://proctorworks:proctorworks@db:5432/proctorworks
      TEST_DATABASE_URL: postgres://proctorworks:proctorworks@db:5432/proctorworks_test
      JWT_SECRET: ${JWT_SECRET:-dev-jwt-secret-min-32-chars-long-for-testing}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY:-00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff}
      NODE_ENV: development
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 5s
      timeout: 3s
      retries: 10
      start_period: 30s

  db:
    image: postgres:16
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: proctorworks
      POSTGRES_PASSWORD: proctorworks
      POSTGRES_DB: proctorworks
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U proctorworks"]
      interval: 5s
      timeout: 3s
      retries: 10
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init-test-db.sql:/docker-entrypoint-initdb.d/init-test-db.sql

volumes:
  pgdata:
```

#### B. Create `init-test-db.sql`
```sql
-- Create test database for isolated testing
CREATE DATABASE proctorworks_test;
GRANT ALL PRIVILEGES ON DATABASE proctorworks_test TO proctorworks;
```

### 2. Improved Test Runner Script

#### Update `run_tests.sh`
```bash
#!/bin/bash
set -e

echo "=== ProctorWorks Test Suite ==="
echo ""

# Function to check if containers are running
check_containers() {
  docker compose ps --status running 2>/dev/null | grep -q "api"
}

# Function to wait for API readiness
wait_for_api() {
  echo "--- Waiting for API to be ready... ---"
  for i in $(seq 1 60); do
    if docker compose exec -T api wget -qO- http://localhost:3000/health >/dev/null 2>&1; then
      echo "--- API is ready ---"
      return 0
    fi
    echo "  waiting... ($i/60)"
    sleep 2
  done
  echo "--- ERROR: API failed to become ready ---"
  return 1
}

# Start containers if not running
if ! check_containers; then
  echo "--- Containers not running, starting... ---"
  docker compose up -d --build
  
  if ! wait_for_api; then
    echo "--- Showing container logs for debugging ---"
    docker compose logs api
    exit 1
  fi
else
  echo "--- Containers already running ---"
  if ! wait_for_api; then
    echo "--- API not responding, restarting containers ---"
    docker compose restart api
    if ! wait_for_api; then
      echo "--- ERROR: Could not get API ready ---"
      exit 1
    fi
  fi
fi

# Run database migrations to ensure schema is up to date
echo "--- Running database migrations ---"
docker compose exec -T api sh -c "npm run typeorm migration:run" || {
  echo "--- Migration failed, attempting to create schema ---"
  docker compose exec -T api sh -c "npm run typeorm schema:sync"
}

# Run unit tests
echo ""
echo "--- Running unit tests ---"
docker compose exec -T api sh -c "npm run test:unit" || UNIT_FAILED=1

# Run API integration tests
echo ""
echo "--- Running API integration tests ---"
docker compose exec -T api sh -c "npm run test:api" || API_FAILED=1

# Summary
echo ""
if [[ -z "$UNIT_FAILED" && -z "$API_FAILED" ]]; then
  echo "=== ALL TESTS PASSED ==="
  exit 0
else
  echo "=== TESTS FAILED ==="
  [[ -n "$UNIT_FAILED" ]] && echo "  - Unit tests failed"
  [[ -n "$API_FAILED" ]] && echo "  - API tests failed"
  exit 1
fi
```

### 3. Enhanced Package.json Scripts

#### Update `package.json` scripts section:
```json
{
  "scripts": {
    "build": "npx tsc",
    "start": "node dist/main",
    "start:dev": "npx ts-node src/main.ts",
    "test": "jest --verbose --detectOpenHandles",
    "test:unit": "jest --testPathPatterns=unit_tests --verbose --detectOpenHandles",
    "test:api": "jest --testPathPatterns=API_tests --verbose --runInBand --detectOpenHandles --forceExit",
    "test:all": "jest --testPathPatterns='unit_tests|API_tests' --verbose --runInBand --detectOpenHandles --forceExit",
    "test:watch": "jest --watch --testPathPatterns=unit_tests",
    "test:coverage": "jest --coverage --testPathPatterns='unit_tests|API_tests'",
    "typeorm": "npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js",
    "migration:generate": "npm run typeorm -- migration:generate",
    "migration:run": "npm run typeorm -- migration:run",
    "migration:revert": "npm run typeorm -- migration:revert",
    "schema:sync": "npm run typeorm -- schema:sync",
    "schema:drop": "npm run typeorm -- schema:drop"
  }
}
```

### 4. Test Environment Configuration

#### Create `src/config/test.config.ts`
```typescript
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const getTestDatabaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  synchronize: true, // Only for tests
  dropSchema: true,  // Clean slate for each test run
  logging: false,
});
```

### 5. Improved API Test Setup

#### Create `API_tests/test-setup.ts`
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { getTestDatabaseConfig } from '../src/config/test.config';

export class TestApp {
  private static instance: TestApp;
  public app: INestApplication;
  public server: any;

  static async getInstance(): Promise<TestApp> {
    if (!TestApp.instance) {
      TestApp.instance = new TestApp();
      await TestApp.instance.initialize();
    }
    return TestApp.instance;
  }

  private async initialize() {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
    .overrideProvider('DATABASE_CONFIG')
    .useValue(getTestDatabaseConfig())
    .compile();

    this.app = moduleFixture.createNestApplication();
    this.app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));

    await this.app.init();
    this.server = this.app.getHttpServer();
  }

  async cleanup() {
    if (this.app) {
      await this.app.close();
    }
  }
}

// Global test helpers
export async function loginAsAdmin(request: any, server: any): Promise<string> {
  const response = await request(server)
    .post('/auth/login')
    .send({ username: 'admin', password: 'Admin1234!' });
  
  if (response.status !== 200) {
    throw new Error(`Login failed: ${response.status} ${response.text}`);
  }
  
  return response.body.accessToken;
}

export function logStep(method: string, path: string, status?: number): void {
  if (status !== undefined) {
    console.log(`  ← ${status}`);
  } else {
    console.log(`  → ${method} ${path}`);
  }
}
```

### 6. Demo Data Seeding

#### Create `migrations/1700000000000-SeedDemoData.ts`
```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcrypt';

export class SeedDemoData1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create admin user
    const adminPasswordHash = await bcrypt.hash('Admin1234!', 10);
    
    await queryRunner.query(`
      INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
      VALUES (
        'admin-1111-1111-1111-111111111111',
        'admin',
        '${adminPasswordHash}',
        'platform_admin',
        'active',
        NOW(),
        NOW()
      ) ON CONFLICT (username) DO NOTHING;
    `);

    // Create demo store
    await queryRunner.query(`
      INSERT INTO stores (id, name, status, created_at, updated_at)
      VALUES (
        'store-1111-1111-1111-111111111111',
        'Demo Store',
        'active',
        NOW(),
        NOW()
      ) ON CONFLICT (id) DO NOTHING;
    `);

    // Create demo study room
    await queryRunner.query(`
      INSERT INTO study_rooms (id, name, description, status, created_at, updated_at)
      VALUES (
        'room-1111-1111-1111-111111111111',
        'Main Study Hall',
        'Primary study area with 50 seats',
        'active',
        NOW(),
        NOW()
      ) ON CONFLICT (id) DO NOTHING;
    `);

    // Create demo zone
    await queryRunner.query(`
      INSERT INTO zones (id, room_id, name, description, created_at, updated_at)
      VALUES (
        'zone-1111-1111-1111-111111111111',
        'room-1111-1111-1111-111111111111',
        'Quiet Zone A',
        'Silent study area',
        NOW(),
        NOW()
      ) ON CONFLICT (id) DO NOTHING;
    `);

    // Create demo seats
    for (let i = 1; i <= 10; i++) {
      await queryRunner.query(`
        INSERT INTO seats (id, zone_id, label, power_outlet, quiet_zone, ada_accessible, status, created_at, updated_at)
        VALUES (
          'seat-${i.toString().padStart(4, '0')}-1111-1111-111111111111',
          'zone-1111-1111-1111-111111111111',
          'A${i}',
          ${i % 2 === 0},
          true,
          ${i <= 2},
          'available',
          NOW(),
          NOW()
        ) ON CONFLICT (id) DO NOTHING;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM seats WHERE zone_id = 'zone-1111-1111-1111-111111111111';`);
    await queryRunner.query(`DELETE FROM zones WHERE id = 'zone-1111-1111-1111-111111111111';`);
    await queryRunner.query(`DELETE FROM study_rooms WHERE id = 'room-1111-1111-1111-111111111111';`);
    await queryRunner.query(`DELETE FROM stores WHERE id = 'store-1111-1111-1111-111111111111';`);
    await queryRunner.query(`DELETE FROM users WHERE username = 'admin';`);
  }
}
```

### 7. Enhanced Health Check Endpoint

#### Update health controller to include database connectivity:
```typescript
// src/health/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  @Get()
  async check() {
    try {
      // Test database connectivity
      await this.dataSource.query('SELECT 1');
      
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'connected',
        environment: process.env.NODE_ENV || 'development',
      };
    } catch (error) {
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        database: 'disconnected',
        error: error.message,
      };
    }
  }
}
```

### 8. Updated README Documentation

#### Enhanced `README.md`:
```markdown
# ProctorWorks

Offline operations platform for managing a catalog-driven practice product business and reservable study spaces.

## Quick Start

### Option 1: Full Test Suite (Recommended)
```bash
./run_tests.sh
```
This will:
- Start Docker containers if not running
- Wait for services to be ready
- Run all unit and API tests
- Show comprehensive test results

### Option 2: Manual Development
```bash
# Start services
docker compose up --build

# Wait for readiness
curl http://localhost:3000/health

# Run tests manually
npm run test:all
```

## API Access

- **API Base**: http://localhost:3000
- **Swagger UI**: http://localhost:3000/api/docs
- **Health Check**: http://localhost:3000/health

## Demo Credentials

| Username | Password   | Role           | Access                    |
|----------|------------|----------------|---------------------------|
| admin    | Admin1234! | platform_admin | Full system access        |

## Demo Data

The system includes seeded demo data:
- **Demo Store**: "Demo Store" for multi-tenant testing
- **Study Room**: "Main Study Hall" with 10 seats
- **Zone**: "Quiet Zone A" with mixed seat attributes
- **Seats**: A1-A10 (some with power outlets, ADA accessible)

## Testing

### Run All Tests
```bash
./run_tests.sh
```

### Run Specific Test Types
```bash
npm run test:unit      # Unit tests only
npm run test:api       # API integration tests only
npm run test:coverage  # With coverage report
```

### Test Database

Tests use isolated test database (`proctorworks_test`) with:
- Clean schema on each run
- Seeded demo data
- No interference with development data

## Development Commands

```bash
# Database operations
npm run migration:generate -- -n MigrationName
npm run migration:run
npm run schema:sync  # Development only

# Development server
npm run start:dev
```

## Architecture

- **Backend**: NestJS + TypeORM + PostgreSQL
- **Authentication**: Local JWT (no external dependencies)
- **Testing**: Jest with supertest for API testing
- **Deployment**: Single Docker host, fully offline capable

## Performance Targets

- **Read Operations**: p95 ≤ 300ms
- **Write Operations**: p95 ≤ 800ms  
- **Throughput**: 50 requests/second
- **Availability**: 99.9% uptime on single host
```

## Expected Outcomes

After implementing these improvements:

1. ✅ **Self-Contained Testing**: `./run_tests.sh` handles everything automatically
2. ✅ **Docker Auto-Management**: Containers start/restart as needed
3. ✅ **Health Check Integration**: Tests wait for API readiness
4. ✅ **Demo Data Available**: Immediate API testing with seeded data
5. ✅ **Test Isolation**: Separate test database prevents conflicts
6. ✅ **Better Error Handling**: Clear feedback when things go wrong
7. ✅ **Professional Documentation**: Complete setup and usage guide

## Implementation Priority

1. **High Priority** (Essential for testing):
   - Enhanced `run_tests.sh` with auto Docker management
   - Health check integration and waiting logic
   - Demo data seeding migration

2. **Medium Priority** (Quality improvements):
   - Test database isolation
   - Enhanced health endpoint
   - Better error handling in tests

3. **Low Priority** (Nice to have):
   - Test coverage reporting
   - Performance monitoring in tests
   - Advanced test utilities

This brings Project 104 up to the same professional standard as Project 17, with self-contained testing and proper Docker lifecycle management.