import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { withSerializableRetry } from '../../common/tx-retry';
import {
  assertDepartmentAccess,
  canAccessAllDepartments,
  type UserScope,
} from '../../auth/department-auth.helper';

export interface CreateDepartmentItemDto {
  sku: string;
  name: string;
  unit: string;
  onHand?: number;
  par?: number;
  costCents?: number;
  location?: string;
  category?: string;
}

export interface UpdateDepartmentItemDto {
  name?: string;
  unit?: string;
  par?: number;
  costCents?: number;
  location?: string;
  category?: string;
  status?: string;
  needsReview?: boolean;
}

export interface InventoryMovementDto {
  movementType: 'receive' | 'issue' | 'waste' | '86' | 'count' | 'transfer_out' | 'transfer_in';
  quantity: number;
  notes?: string;
  referenceId?: string;
}

export interface TransferRequestDto {
  toDepartmentId: string;
  items: Array<{ sku: string; name: string; quantity: number }>;
  notes?: string;
}

@Injectable()
export class DepartmentInventoryService {
  private readonly logger = new Logger(DepartmentInventoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists inventory items owned by a specific department.
   * Access is strictly checked via assertDepartmentAccess — never returns 200 + empty for unauthorized.
   */
  async listItems(
    facilityId: string,
    departmentId: string,
    scope: UserScope,
    filters?: { search?: string; status?: string; needsReview?: boolean },
  ) {
    await assertDepartmentAccess(scope, facilityId, departmentId, this.prisma);

    const where: Record<string, unknown> = {
      facilityId,
      departmentId,
    };

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.needsReview !== undefined) {
      where.needsReview = filters.needsReview;
    }
    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { sku: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.departmentInventoryItem.findMany({
      where: where as any,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * Retrieves a single department inventory item.
   */
  async getItem(facilityId: string, departmentId: string, itemId: string, scope: UserScope) {
    await assertDepartmentAccess(scope, facilityId, departmentId, this.prisma);

    const item = await this.prisma.departmentInventoryItem.findFirst({
      where: { id: itemId, facilityId, departmentId },
    });

    if (!item) {
      throw new NotFoundException('Inventory item not found in this department');
    }

    return item;
  }

  /**
   * Creates a new department-scoped inventory item.
   */
  async createItem(
    facilityId: string,
    departmentId: string,
    data: CreateDepartmentItemDto,
    scope: UserScope,
  ) {
    await assertDepartmentAccess(scope, facilityId, departmentId, this.prisma);

    const venue = await this.prisma.venue.findUniqueOrThrow({
      where: { id: facilityId },
      select: { organizationId: true },
    });

    const existing = await this.prisma.departmentInventoryItem.findUnique({
      where: {
        facilityId_departmentId_sku: {
          facilityId,
          departmentId,
          sku: data.sku.trim(),
        },
      },
    });

    if (existing) {
      throw new ConflictException(`An item with SKU "${data.sku}" already exists in this department`);
    }

    const onHand = data.onHand ?? 0;

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.departmentInventoryItem.create({
        data: {
          organizationId: venue.organizationId,
          facilityId,
          departmentId,
          sku: data.sku.trim(),
          name: data.name.trim(),
          unit: data.unit.trim(),
          onHand,
          par: data.par ?? 0,
          costCents: data.costCents,
          location: data.location?.trim(),
          category: data.category?.trim(),
          status: 'active',
          needsReview: false,
        },
      });

      if (onHand > 0) {
        await tx.departmentInventoryMovement.create({
          data: {
            organizationId: venue.organizationId,
            facilityId,
            departmentId,
            itemId: item.id,
            movementType: 'receive',
            quantity: onHand,
            previousOnHand: 0,
            newOnHand: onHand,
            actorId: scope.userId,
            notes: 'Initial stock receipt',
          },
        });
      }

      return item;
    });
  }

  /**
   * Updates an item's details.
   */
  async updateItem(
    facilityId: string,
    departmentId: string,
    itemId: string,
    data: UpdateDepartmentItemDto,
    scope: UserScope,
  ) {
    await assertDepartmentAccess(scope, facilityId, departmentId, this.prisma);

    const existing = await this.prisma.departmentInventoryItem.findFirst({
      where: { id: itemId, facilityId, departmentId },
    });

    if (!existing) {
      throw new NotFoundException('Inventory item not found in this department');
    }

    return this.prisma.departmentInventoryItem.update({
      where: { id: itemId },
      data: {
        name: data.name?.trim(),
        unit: data.unit?.trim(),
        par: data.par,
        costCents: data.costCents,
        location: data.location?.trim(),
        category: data.category?.trim(),
        status: data.status,
        needsReview: data.needsReview,
      },
    });
  }

  /**
   * Records an inventory movement (receive, issue, waste, 86, count) on a department ledger.
   */
  async recordMovement(
    facilityId: string,
    departmentId: string,
    itemId: string,
    dto: InventoryMovementDto,
    scope: UserScope,
  ) {
    await assertDepartmentAccess(scope, facilityId, departmentId, this.prisma);

    return withSerializableRetry(this.prisma, async (tx) => {
      const item = await tx.departmentInventoryItem.findFirst({
        where: { id: itemId, facilityId, departmentId },
      });

      if (!item) {
        throw new NotFoundException('Inventory item not found in this department');
      }

      let newOnHand = item.onHand;
      let newStatus = item.status;

      switch (dto.movementType) {
        case 'receive':
        case 'transfer_in':
          newOnHand = item.onHand + dto.quantity;
          break;
        case 'issue':
        case 'waste':
        case 'transfer_out':
          newOnHand = Math.max(0, item.onHand - dto.quantity);
          break;
        case 'count':
          newOnHand = Math.max(0, dto.quantity);
          break;
        case '86':
          newOnHand = 0;
          newStatus = '86ed';
          break;
        default:
          throw new BadRequestException(`Unknown movement type: ${dto.movementType}`);
      }

      await tx.departmentInventoryItem.update({
        where: { id: itemId },
        data: {
          onHand: newOnHand,
          status: newStatus,
        },
      });

      const movement = await tx.departmentInventoryMovement.create({
        data: {
          organizationId: item.organizationId,
          facilityId,
          departmentId,
          itemId,
          movementType: dto.movementType,
          quantity: dto.quantity,
          previousOnHand: item.onHand,
          newOnHand,
          referenceId: dto.referenceId,
          notes: dto.notes,
          actorId: scope.userId,
        },
      });

      return {
        item: { ...item, onHand: newOnHand, status: newStatus },
        movement,
      };
    });
  }

  /**
   * Submits a transfer request between departments.
   * Requester sees only their department's side.
   */
  async requestTransfer(
    facilityId: string,
    fromDepartmentId: string,
    dto: TransferRequestDto,
    scope: UserScope,
  ) {
    await assertDepartmentAccess(scope, facilityId, fromDepartmentId, this.prisma);

    if (fromDepartmentId === dto.toDepartmentId) {
      throw new BadRequestException('Source and destination departments must be different');
    }

    const toDept = await this.prisma.department.findFirst({
      where: { id: dto.toDepartmentId, facilityId },
    });
    if (!toDept) {
      throw new NotFoundException('Destination department not found in this facility');
    }

    const venue = await this.prisma.venue.findUniqueOrThrow({
      where: { id: facilityId },
      select: { organizationId: true },
    });

    return this.prisma.inventoryTransferRequest.create({
      data: {
        organizationId: venue.organizationId,
        facilityId,
        fromDepartmentId,
        toDepartmentId: dto.toDepartmentId,
        items: dto.items as any,
        requestedBy: scope.userId,
        status: 'pending',
      },
    });
  }

  /**
   * Approves a transfer request.
   * Must be approved by warehouse/procurement or leadership.
   * Decrements source department ledger and increments destination department ledger.
   */
  async approveTransfer(facilityId: string, transferId: string, scope: UserScope) {
    const isLeadershipOrWarehouse = await canAccessAllDepartments(scope, facilityId, this.prisma);
    if (!isLeadershipOrWarehouse) {
      throw new ForbiddenException('Only warehouse, procurement, or venue leadership may approve stock transfers');
    }

    return withSerializableRetry(this.prisma, async (tx) => {
      const transfer = await tx.inventoryTransferRequest.findUnique({
        where: { id: transferId },
      });

      if (!transfer || transfer.facilityId !== facilityId) {
        throw new NotFoundException('Transfer request not found');
      }
      if (transfer.status !== 'pending') {
        throw new ConflictException(`Transfer is already ${transfer.status}`);
      }
      if (!transfer.fromDepartmentId || !transfer.toDepartmentId) {
        throw new BadRequestException('Transfer request is missing source or destination department');
      }

      const items = (transfer.items as Array<{ sku: string; name: string; quantity: number }>) || [];

      for (const tItem of items) {
        // 1. Decrement source department
        const sourceItem = await tx.departmentInventoryItem.findFirst({
          where: {
            facilityId,
            departmentId: transfer.fromDepartmentId,
            sku: tItem.sku,
          },
        });

        if (sourceItem) {
          const prev = sourceItem.onHand;
          const next = Math.max(0, prev - tItem.quantity);
          await tx.departmentInventoryItem.update({
            where: { id: sourceItem.id },
            data: { onHand: next },
          });

          await tx.departmentInventoryMovement.create({
            data: {
              organizationId: transfer.organizationId,
              facilityId,
              departmentId: transfer.fromDepartmentId,
              itemId: sourceItem.id,
              movementType: 'transfer_out',
              quantity: tItem.quantity,
              previousOnHand: prev,
              newOnHand: next,
              referenceId: transferId,
              actorId: scope.userId,
              notes: `Transfer out to department ${transfer.toDepartmentId}`,
            },
          });
        }

        // 2. Increment destination department
        let destItem = await tx.departmentInventoryItem.findFirst({
          where: {
            facilityId,
            departmentId: transfer.toDepartmentId,
            sku: tItem.sku,
          },
        });

        if (destItem) {
          const prev = destItem.onHand;
          const next = prev + tItem.quantity;
          await tx.departmentInventoryItem.update({
            where: { id: destItem.id },
            data: { onHand: next },
          });

          await tx.departmentInventoryMovement.create({
            data: {
              organizationId: transfer.organizationId,
              facilityId,
              departmentId: transfer.toDepartmentId,
              itemId: destItem.id,
              movementType: 'transfer_in',
              quantity: tItem.quantity,
              previousOnHand: prev,
              newOnHand: next,
              referenceId: transferId,
              actorId: scope.userId,
              notes: `Transfer in from department ${transfer.fromDepartmentId}`,
            },
          });
        } else {
          // Destination department does not have this SKU yet — create it
          destItem = await tx.departmentInventoryItem.create({
            data: {
              organizationId: transfer.organizationId,
              facilityId,
              departmentId: transfer.toDepartmentId,
              sku: tItem.sku,
              name: tItem.name || sourceItem?.name || tItem.sku,
              unit: sourceItem?.unit || 'ea',
              onHand: tItem.quantity,
              par: sourceItem?.par || 0,
              costCents: sourceItem?.costCents,
              status: 'active',
            },
          });

          await tx.departmentInventoryMovement.create({
            data: {
              organizationId: transfer.organizationId,
              facilityId,
              departmentId: transfer.toDepartmentId,
              itemId: destItem.id,
              movementType: 'transfer_in',
              quantity: tItem.quantity,
              previousOnHand: 0,
              newOnHand: tItem.quantity,
              referenceId: transferId,
              actorId: scope.userId,
              notes: `Transfer in initial stock from department ${transfer.fromDepartmentId}`,
            },
          });
        }
      }

      return tx.inventoryTransferRequest.update({
        where: { id: transferId },
        data: {
          status: 'completed',
          approvedBy: scope.userId,
          completedAt: new Date(),
        },
      });
    });
  }

  /**
   * Warehouse review queue: lists items flagged with needsReview=true across the facility.
   * Only accessible to leadership or warehouse/procurement.
   */
  async getNeedsReviewQueue(facilityId: string, scope: UserScope) {
    const isLeadershipOrWarehouse = await canAccessAllDepartments(scope, facilityId, this.prisma);
    if (!isLeadershipOrWarehouse) {
      throw new ForbiddenException('Needs review queue is restricted to warehouse and leadership');
    }

    return this.prisma.departmentInventoryItem.findMany({
      where: {
        facilityId,
        needsReview: true,
      },
      include: {
        department: {
          select: { id: true, code: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Backfill existing split inventory into department-scoped ledger.
   * Idempotent: Skips SKUs already present in destination department.
   */
  async backfillExistingInventory(facilityId: string, organizationId: string) {
    const departments = await this.prisma.department.findMany({
      where: { facilityId },
      select: { id: true, code: true },
    });
    const deptByCode = new Map(departments.map((d) => [d.code.toUpperCase(), d.id]));

    const beverageId = deptByCode.get('BEVERAGE');
    const concessionsId = deptByCode.get('CONCESSIONS');
    const culinaryId = deptByCode.get('CULINARY');
    const banquetId = deptByCode.get('BANQUET_CATERING');
    const warehouseId = deptByCode.get('WAREHOUSE');

    let migrated = 0;

    // 1. Backfill BarInventoryItem -> BEVERAGE
    if (beverageId) {
      const barItems = await this.prisma.barInventoryItem.findMany({
        where: { venueId: facilityId },
      });
      for (const bar of barItems) {
        const existing = await this.prisma.departmentInventoryItem.findUnique({
          where: {
            facilityId_departmentId_sku: {
              facilityId,
              departmentId: beverageId,
              sku: bar.sku || `BAR-${bar.id}`,
            },
          },
        });
        if (!existing) {
          await this.prisma.departmentInventoryItem.create({
            data: {
              organizationId,
              facilityId,
              departmentId: beverageId,
              sku: bar.sku || `BAR-${bar.id}`,
              name: bar.name,
              unit: bar.unit || 'btl',
              onHand: bar.onHand ?? 0,
              par: (bar as any).par ?? 0,
              category: bar.category,
              costCents: (bar as any).costCents ?? null,
              status: (bar as any).isActive === false ? 'archived' : 'active',
            },
          });
          migrated++;
        }
      }
    }

    return { migrated };
  }
}
