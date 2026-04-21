import { Column, Entity, JoinColumn, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  plate: string;

  @Column()
  brand: string;

  @Column()
  model: string;

  @Column()
  color: string;

  @Column({ type: 'int', default: 4 })
  capacity: number; // ← usa "capacity", NO "seats"

  @OneToOne(() => User, user => user.vehicle, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;
}