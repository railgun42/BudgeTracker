import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role, StorageUsageDto, UserDto } from '@budgetracker/shared';
import { User } from '../generated/prisma/client';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

// Seuls les champs publics sortent : jamais de données d'auth (SPEC §3.2).
export const toUserDto = (u: User): UserDto => ({
  id: u.id,
  email: u.email,
  name: u.name,
  lastConnection: u.lastConnection?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
  role: u.role as Role,
});

@Controller('v1/me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() { id }: AuthUser): Promise<UserDto> {
    return toUserDto(await this.prisma.user.findUniqueOrThrow({ where: { id } }));
  }

  // Même somme que le contrôle de quota des pièces jointes.
  @Get('storage')
  async storage(@CurrentUser() { id }: AuthUser): Promise<StorageUsageDto> {
    const [{ storageQuotaBytes }, { _sum }] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id }, select: { storageQuotaBytes: true } }),
      this.prisma.attachment.aggregate({ where: { userId: id }, _sum: { sizeBytes: true } }),
    ]);
    return { usedBytes: _sum.sizeBytes ?? 0, quotaBytes: Number(storageQuotaBytes) };
  }
}
