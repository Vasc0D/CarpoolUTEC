// This DTO is intentionally minimal — users are only created via Google OAuth,
// so name and email come from a validated, trusted Google profile.
// Direct user creation via HTTP is not exposed.
export class CreateUserDto {
  name: string;
  email: string;
}
