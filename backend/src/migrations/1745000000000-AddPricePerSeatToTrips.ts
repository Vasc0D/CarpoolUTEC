import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPricePerSeatToTrips1745000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "pricePerSeat" numeric(6,2) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "trips" DROP COLUMN IF EXISTS "pricePerSeat"`);
  }
}
