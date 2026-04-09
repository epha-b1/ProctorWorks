import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Product, ProductStatus } from './entities/product.entity';
import { Category } from './entities/category.entity';
import { Brand } from './entities/brand.entity';
import { Sku } from './entities/sku.entity';
import { SkuPriceTier } from './entities/sku-price-tier.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateSkuDto } from './dto/create-sku.dto';
import { UpdateSkuDto } from './dto/update-sku.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateBrandDto } from './dto/create-brand.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Brand)
    private readonly brandRepo: Repository<Brand>,
    @InjectRepository(Sku)
    private readonly skuRepo: Repository<Sku>,
    @InjectRepository(SkuPriceTier)
    private readonly priceTierRepo: Repository<SkuPriceTier>,
    private readonly dataSource: DataSource,
  ) {}

  /* ── helpers ── */

  private getUserStoreId(user: any): string | null {
    return user?.storeId ?? user?.store_id ?? null;
  }

  private enforceStoreScope(user: any): string {
    if (user.role === 'store_admin') {
      const storeId = this.getUserStoreId(user);
      if (!storeId) {
        throw new ForbiddenException('Store admin has no assigned store');
      }
      return storeId;
    }
    return null;
  }

  private async findProductOrFail(id: string, user: any): Promise<Product> {
    const product = await this.productRepo.findOne({
      where: { id },
      relations: ['category', 'brand', 'skus', 'skus.priceTiers'],
    });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    const storeId = this.enforceStoreScope(user);
    if (storeId && product.store_id !== storeId) {
      throw new ForbiddenException('Access denied to this product');
    }
    return product;
  }

  /* ── Products ── */

  async createProduct(dto: CreateProductDto, user: any): Promise<Product> {
    const storeId = this.enforceStoreScope(user);
    const product = this.productRepo.create({
      name: dto.name,
      category_id: dto.categoryId,
      brand_id: dto.brandId,
      store_id: storeId || this.getUserStoreId(user),
    });
    return this.productRepo.save(product);
  }

  async findAllProducts(user: any): Promise<Product[]> {
    const storeId = this.enforceStoreScope(user);
    const where: any = {};
    if (storeId) where.store_id = storeId;
    return this.productRepo.find({
      where,
      relations: ['category', 'brand', 'skus'],
    });
  }

  async findProductById(id: string, user: any): Promise<Product> {
    return this.findProductOrFail(id, user);
  }

  async updateProduct(
    id: string,
    dto: UpdateProductDto,
    user: any,
  ): Promise<Product> {
    const product = await this.findProductOrFail(id, user);
    if (dto.name !== undefined) product.name = dto.name;
    return this.productRepo.save(product);
  }

  async deleteProduct(id: string, user: any): Promise<void> {
    const product = await this.findProductOrFail(id, user);
    await this.productRepo.remove(product);
  }

  /**
   * Submit a product for reviewer approval.
   *
   * audit_report-1 §5.5 — the previous flow allowed `content_reviewer`
   * and `platform_admin` to flip a product straight to PUBLISHED via
   * this endpoint, bypassing the explicit "review decision" step the
   * prompt's governance model calls for. The fix routes EVERY publish
   * request through the same `pending_review` gate; final publication
   * is now only possible via `approveProduct`, which is auditable as a
   * distinct reviewer action.
   *
   * Backward compatibility: HTTP path stays the same. The only
   * behavioural change is that platform_admin / content_reviewer no
   * longer skip the review state — they must call /approve afterwards.
   */
  async publishProduct(id: string, user: any): Promise<Product> {
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);

    // store_admin can only submit a product in their own store. Other
    // roles bypass the store check (the controller already restricts
    // who can call this endpoint), but every role lands on the same
    // pending_review state — no direct-publish bypass.
    if (user.role === 'store_admin') {
      const storeId = this.getUserStoreId(user);
      if (!storeId) {
        throw new ForbiddenException('Store admin has no assigned store');
      }
      if (product.store_id !== storeId) {
        throw new ForbiddenException('Access denied to this product');
      }
    } else if (
      user.role !== 'content_reviewer' &&
      user.role !== 'platform_admin'
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }

    // Idempotent transition from anything-but-published into
    // pending_review. Re-submitting a product that's already in
    // pending_review is a no-op (preserves auditable timestamps).
    if (
      product.status !== ProductStatus.PENDING_REVIEW &&
      product.status !== ProductStatus.PUBLISHED
    ) {
      product.status = ProductStatus.PENDING_REVIEW;
    } else if (product.status === ProductStatus.PUBLISHED) {
      // Re-submitting a published product knocks it back into review —
      // approves it again to actually re-publish.
      product.status = ProductStatus.PENDING_REVIEW;
    }

    return this.productRepo.save(product);
  }

  /**
   * Reviewer-approval transition: pending_review → published.
   *
   * Only `content_reviewer` and `platform_admin` can perform this
   * action. The product MUST be in `pending_review` — direct draft →
   * published is no longer possible (closes audit_report-1 §5.5).
   */
  async approveProduct(id: string, user: any): Promise<Product> {
    if (
      user.role !== 'content_reviewer' &&
      user.role !== 'platform_admin'
    ) {
      throw new ForbiddenException(
        'Only content_reviewer or platform_admin can approve products',
      );
    }

    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);

    if (product.status !== ProductStatus.PENDING_REVIEW) {
      throw new ConflictException(
        `Cannot approve product in status '${product.status}'. Must be 'pending_review'.`,
      );
    }

    product.status = ProductStatus.PUBLISHED;
    return this.productRepo.save(product);
  }

  async unpublishProduct(id: string, user: any): Promise<Product> {
    if (
      user.role !== 'content_reviewer' &&
      user.role !== 'platform_admin'
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }
    const product = await this.productRepo.findOne({ where: { id } });
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    product.status = ProductStatus.UNPUBLISHED;
    return this.productRepo.save(product);
  }

  /* ── SKUs ── */

  async createSku(productId: string, dto: CreateSkuDto, user: any): Promise<Sku> {
    await this.findProductOrFail(productId, user);

    return this.dataSource.transaction(async (manager) => {
      const sku = manager.create(Sku, {
        product_id: productId,
        sku_code: dto.skuCode,
        price_cents: dto.priceCents,
        member_price_cents: dto.memberPriceCents ?? null,
        attributes: dto.attributes ?? null,
      });
      const savedSku = await manager.save(sku);

      if (dto.priceTiers && dto.priceTiers.length > 0) {
        const tiers = dto.priceTiers.map((t) =>
          manager.create(SkuPriceTier, {
            sku_id: savedSku.id,
            tier_name: t.tierName,
            price_cents: t.priceCents,
          }),
        );
        await manager.save(tiers);
      }

      return manager.findOne(Sku, {
        where: { id: savedSku.id },
        relations: ['priceTiers'],
      });
    });
  }

  async findSkusByProduct(productId: string, user: any): Promise<Sku[]> {
    await this.findProductOrFail(productId, user);
    return this.skuRepo.find({
      where: { product_id: productId },
      relations: ['priceTiers'],
    });
  }

  async updateSku(id: string, dto: UpdateSkuDto, user: any): Promise<Sku> {
    const sku = await this.skuRepo.findOne({
      where: { id },
      relations: ['product', 'priceTiers'],
    });
    if (!sku) throw new NotFoundException(`SKU ${id} not found`);

    // enforce store scope via the parent product
    await this.findProductOrFail(sku.product_id, user);

    return this.dataSource.transaction(async (manager) => {
      if (dto.priceCents !== undefined) sku.price_cents = dto.priceCents;
      if (dto.memberPriceCents !== undefined)
        sku.member_price_cents = dto.memberPriceCents;
      if (dto.attributes !== undefined) sku.attributes = dto.attributes;
      await manager.save(sku);

      if (dto.priceTiers !== undefined) {
        await manager.delete(SkuPriceTier, { sku_id: sku.id });
        if (dto.priceTiers.length > 0) {
          const tiers = dto.priceTiers.map((t) =>
            manager.create(SkuPriceTier, {
              sku_id: sku.id,
              tier_name: t.tierName,
              price_cents: t.priceCents,
            }),
          );
          await manager.save(tiers);
        }
      }

      return manager.findOne(Sku, {
        where: { id: sku.id },
        relations: ['priceTiers'],
      });
    });
  }

  async deleteSku(id: string, user: any): Promise<void> {
    const sku = await this.skuRepo.findOne({
      where: { id },
      relations: ['product'],
    });
    if (!sku) throw new NotFoundException(`SKU ${id} not found`);
    await this.findProductOrFail(sku.product_id, user);
    await this.skuRepo.remove(sku);
  }

  /* ── Categories ── */

  async createCategory(dto: CreateCategoryDto): Promise<Category> {
    const category = this.categoryRepo.create({
      name: dto.name,
      parent_id: dto.parentId ?? null,
    });
    return this.categoryRepo.save(category);
  }

  async findAllCategories(): Promise<Category[]> {
    return this.categoryRepo.find({ relations: ['children'] });
  }

  /* ── Brands ── */

  async createBrand(dto: CreateBrandDto): Promise<Brand> {
    const brand = this.brandRepo.create({ name: dto.name });
    return this.brandRepo.save(brand);
  }

  async findAllBrands(): Promise<Brand[]> {
    return this.brandRepo.find();
  }
}
