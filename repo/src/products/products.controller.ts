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

@ApiTags('Products')
@ApiBearerAuth()
@Controller()
@UseGuards(RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /* ── Products ── */

  @Post('products')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Create a product' })
  @ApiResponse({ status: 201, description: 'Product created' })
  createProduct(@Body() dto: CreateProductDto, @CurrentUser() user: any) {
    return this.productsService.createProduct(dto, user);
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
  ) {
    return this.productsService.updateProduct(id, dto, user);
  }

  @Delete('products/:id')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Delete a product' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product deleted' })
  deleteProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.productsService.deleteProduct(id, user);
  }

  @Post('products/:id/publish')
  @Roles('store_admin', 'content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Publish or submit product for review' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product status updated' })
  publishProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.productsService.publishProduct(id, user);
  }

  @Post('products/:id/unpublish')
  @Roles('content_reviewer', 'platform_admin')
  @ApiOperation({ summary: 'Unpublish a product' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Product unpublished' })
  unpublishProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.productsService.unpublishProduct(id, user);
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
  ) {
    return this.productsService.createSku(id, dto, user);
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
  ) {
    return this.productsService.updateSku(id, dto, user);
  }

  @Delete('skus/:id')
  @Roles('store_admin', 'platform_admin')
  @ApiOperation({ summary: 'Delete a SKU' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'SKU deleted' })
  deleteSku(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    return this.productsService.deleteSku(id, user);
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
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.productsService.createCategory(dto);
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
  createBrand(@Body() dto: CreateBrandDto) {
    return this.productsService.createBrand(dto);
  }
}
