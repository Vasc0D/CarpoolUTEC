import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * C-1: Booking entity gained @CreateDateColumn / @UpdateDateColumn in Phase 2.
 * In production (synchronize: false) those columns were never created on disk,
 * so ORDER BY "createdAt" in getMyBookings() silently fails or returns wrong results.
 * This migration back-fills them with safe defaults.
 */
export class AddTimestampsToBookings1745400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
        ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "bookings"
        DROP COLUMN IF EXISTS "createdAt",
        DROP COLUMN IF EXISTS "updatedAt"
    `);
  }
}
