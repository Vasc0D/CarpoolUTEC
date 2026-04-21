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
  ) { }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { email } });
  }

  async findByIdWithVehicle(id: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
      relations: ['vehicle']
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async create(userObj: Partial<User>): Promise<User> {
    const user = this.userRepository.create(userObj);
    return this.userRepository.save(user);
  }

  async createVehicle(userId: string, createVehicleDto: CreateVehicleDto): Promise<Vehicle> {
    const user = await this.findByIdWithVehicle(userId);
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (user.vehicle) {
      // Si ya tiene vehículo, lo eliminamos para asignar el nuevo (por simplicidad One-to-One)
      await this.vehicleRepository.delete(user.vehicle.id);
    }

    const vehicle = this.vehicleRepository.create({
      ...createVehicleDto,
      user,
    });

    return this.vehicleRepository.save(vehicle);
  }
}
