import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateBrandDto } from './dto/create-brand.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TraceId } from '../common/decorators/trace-id.decorator';
import { AuditService } from '../audit/audit.service';

@ApiTags('Products')
@ApiBearerAuth()
@Controller()
@UseGuards(RolesGuard)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly auditService: AuditService,
  ) {}

  /* ── Products ── */

  @Post('products')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Create a product' })
  @ApiResponse({ status: 201, description: 'Product created' })
  async createProduct(
    @Body() dto: CreateProductDto,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    const product = await this.productsService.createProduct(dto, user);
    await this.auditService.log(
      user.id,
      'create_product',
      'product',
      product.id,
      undefined,
      traceId,
    );
    return product;
  }

  @Get('products')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'List products' })
  @ApiResponse({ status: 200, description: 'List of products' })
  findAllProducts(@CurrentUser() user: any) {
    return this.productsService.findAllProducts(user);
  }

  @Get('products/:id')
  @Roles('store_admin', 'platform_admin', 'content_reviewer')
  @ApiOperation({ summary: 'Get product by ID' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product details' })
  findProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.productsService.findProductById(id, user);
  }

  @Patch('products/:id')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Update a product' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product updated' })
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    return this.productsService.updateProduct(id, dto, user).then(async (product) => {
      await this.auditService.log(
        user.id,
        'update_product',
        'product',
        id,
        { fields: Object.keys(dto || {}) },
        traceId,
      );
      return product;
    });
  }

  @Delete('products/:id')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Delete a product' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product deleted' })
  deleteProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    return this.productsService.deleteProduct(id, user).then(async (result) => {
      await this.auditService.log(
        user.id,
        'delete_product',
        'product',
        id,
        undefined,
        traceId,
      );
      return result;
    });
  }

  @Post('products/:id/publish')
  @Roles('store_admin', 'content_reviewer', 'platform_admin')
  @ApiOperation({
    summary: 'Submit product for reviewer approval (pending_review)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description:
      'Product moved to pending_review. Use POST /products/:id/approve to publish.',
  })
  publishProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    return this.productsService.publishProduct(id, user).then(async (product) => {
      await this.auditService.log(
        user.id,
        'publish_product',
        'product',
        id,
        undefined,
        traceId,
      );
      return product;
    });
  }

  @Post('products/:id/approve')
  @Roles('content_reviewer', 'platform_admin')
  @ApiOperation({
    summary: 'Approve a pending_review product (final publish)',
  })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Product approved and published',
  })
  @ApiResponse({
    status: 409,
    description: 'Product is not in pending_review',
  })
  approveProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    return this.productsService.approveProduct(id, user).then(async (product) => {
      // Distinct audit action so the reviewer's explicit decision is
      // traceable in the audit log, separate from the original
      // submitter's `publish_product` request.
      await this.auditService.log(
        user.id,
        'approve_product',
        'product',
        id,
        undefined,
        traceId,
      );
      return product;
    });
  }

  @Post('products/:id/unpublish')
  @Roles('content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Unpublish a product' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product unpublished' })
  unpublishProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    return this.productsService.unpublishProduct(id, user).then(async (product) => {
      await this.auditService.log(
        user.id,
        'unpublish_product',
        'product',
        id,
        undefined,
        traceId,
      );
      return product;
    });
  }

  /* ── SKUs ── */

  @Get('products/:id/skus')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'List SKUs for a product' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'List of SKUs' })
  findSkus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.productsService.findSkusByProduct(id, user);
  }

  @Post('products/:id/skus')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Create a SKU for a product' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'SKU created' })
  createSku(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSkuDto,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    return this.productsService.createSku(id, dto, user).then(async (sku) => {
      await this.auditService.log(
        user.id,
        'create_sku',
        'sku',
        sku.id,
        { productId: id },
        traceId,
      );
      return sku;
    });
  }

  @Patch('skus/:id')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Update a SKU' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'SKU updated' })
  updateSku(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSkuDto,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    return this.productsService.updateSku(id, dto, user).then(async (sku) => {
      await this.auditService.log(
        user.id,
        'update_sku',
        'sku',
        id,
        { fields: Object.keys(dto || {}) },
        traceId,
      );
      return sku;
    });
  }

  @Delete('skus/:id')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Delete a SKU' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'SKU deleted' })
  deleteSku(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @TraceId() traceId?: string,
  ) {
    return this.productsService.deleteSku(id, user).then(async (result) => {
      await this.auditService.log(
        user.id,
        'delete_sku',
        'sku',
        id,
        undefined,
        traceId,
      );
      return result;
    });
  }

  /* ── Categories ── */

  @Get('categories')
  @ApiOperation({ summary: 'List all categories' })
  @ApiResponse({ status: 200, description: 'List of categories' })
  findAllCategories() {
    return this.productsService.findAllCategories();
  }

  @Post('categories')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Create a category' })
  @ApiResponse({ status: 201, description: 'Category created' })
  async createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    const category = await this.productsService.createCategory(dto);
    await this.auditService.log(
      actorId,
      'create_category',
      'category',
      category.id,
      undefined,
      traceId,
    );
    return category;
  }

  /* ── Brands ── */

  @Get('brands')
  @ApiOperation({ summary: 'List all brands' })
  @ApiResponse({ status: 200, description: 'List of brands' })
  findAllBrands() {
    return this.productsService.findAllBrands();
  }

  @Post('brands')
  @Roles('platform_admin')
  @ApiOperation({ summary: 'Create a brand' })
  @ApiResponse({ status: 201, description: 'Brand created' })
  async createBrand(
    @Body() dto: CreateBrandDto,
    @CurrentUser('id') actorId: string,
    @TraceId() traceId?: string,
  ) {
    const brand = await this.productsService.createBrand(dto);
    await this.auditService.log(
      actorId,
      'create_brand',
      'brand',
      brand.id,
      undefined,
      traceId,
    );
    return brand;
  }
}
