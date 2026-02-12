export type Role = "admin" | "viewer";

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
};

export type PublicUser = Omit<User, "passwordHash">;

export function toPublicUser(user: User): PublicUser {
  const { passwordHash, ...rest } = user;
  void passwordHash;
  return rest;
}
