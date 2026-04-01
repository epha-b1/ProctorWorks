import { randomBytes } from 'crypto';

export default () => {
  if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return {
    database: {
      url: process.env.DATABASE_URL || 'postgres://proctorworks:proctorworks@localhost:5432/proctorworks',
    },
    jwt: {
      secret: process.env.JWT_SECRET || `dev-only-${randomBytes(32).toString('hex')}`,
      expiry: process.env.JWT_EXPIRY || '8h',
    },
    bcrypt: {
      rounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 12,
    },
    encryption: {
      key: process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
    lowStockThreshold: parseInt(process.env.LOW_STOCK_THRESHOLD, 10) || 10,
    stalenessThresholdHours: parseInt(process.env.STALENESS_THRESHOLD_HOURS, 10) || 24,
    port: parseInt(process.env.PORT, 10) || 3000,
  };
};
