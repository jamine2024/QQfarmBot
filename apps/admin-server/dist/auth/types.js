export function toPublicUser(user) {
    const { passwordHash, ...rest } = user;
    void passwordHash;
    return rest;
}
