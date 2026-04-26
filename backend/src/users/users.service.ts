import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { CreateVehicleDto } from '../vehicles/dto/create-vehicle.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,
  ) {}

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async findByIdWithVehicle(id: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
      relations: ['vehicle'],
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async create(data: Pick<User, 'email' | 'name'>): Promise<User> {
    const user = this.userRepository.create(data);
    return this.userRepository.save(user);
  }

  /**
   * Returns a safe profile projection — only the fields the client legitimately needs.
   * Does NOT include relation arrays (trips, bookings) that could trigger N+1 loads.
   */
  async getProfile(id: string): Promise<{ id: string; name: string; email: string; phone: string | null; vehicle: Vehicle | null }> {
    const user = await this.userRepository.findOne({
      where: { id },
      relations: ['vehicle'],
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone ?? null,
      vehicle: user.vehicle ?? null,
    };
  }

  async createVehicle(userId: string, createVehicleDto: CreateVehicleDto): Promise<Vehicle> {
    const user = await this.findByIdWithVehicle(userId);
    if (!user) throw new NotFoundException('Usuario no encontrado');

    if (user.vehicle) {
      // Replace existing vehicle (one-to-one relationship)
      await this.vehicleRepository.delete(user.vehicle.id);
    }

    const vehicle = this.vehicleRepository.create({ ...createVehicleDto, user });
    return this.vehicleRepository.save(vehicle);
  }
}
