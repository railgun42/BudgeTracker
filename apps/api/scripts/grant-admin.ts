import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';

// Seul moyen de devenir administrateur (SPEC §13.1) : aucune route HTTP ne modifie User.role.
// Usage : npm run admin:grant -w api -- <email>
export async function grantAdmin(prisma: PrismaClient, email: string): Promise<{ userId: string; alreadyAdmin: boolean }> {
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) throw new Error('Aucun compte pour cet e-mail');
  if (!user.emailVerifiedAt) throw new Error("E-mail non vérifié : l'utilisateur doit d'abord vérifier son adresse");
  if (user.role === 'ADMIN') return { userId: user.id, alreadyAdmin: true };
  // adminId NULL : action d'exploitation, hors session d'un administrateur.
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } }),
    prisma.adminAuditLog.create({ data: { action: 'ADMIN_GRANTED', targetId: user.id } }),
  ]);
  return { userId: user.id, alreadyAdmin: false };
}

if (require.main === module) {
  try {
    process.loadEnvFile('../../.env');
  } catch {
    // absent : variables déjà dans l'environnement
  }
  const email = process.argv[2];
  if (!email) {
    console.error('Usage : npm run admin:grant -w api -- <email>');
    process.exit(1);
  }
  const prisma = new PrismaService();
  grantAdmin(prisma, email)
    // Identifiant seulement : jamais d'e-mail dans les sorties.
    .then(({ userId, alreadyAdmin }) => console.log(alreadyAdmin ? `Déjà administrateur : ${userId}` : `Rôle ADMIN attribué : ${userId}`))
    .catch((err: Error) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
