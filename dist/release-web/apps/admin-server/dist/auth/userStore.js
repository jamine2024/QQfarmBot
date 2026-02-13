import path from "node:path";
import crypto from "node:crypto";
import { readJsonFile, writeJsonFile, ensureDir } from "../storage/jsonStore.js";
import { hashPassword, verifyPassword } from "./password.js";
/**
 * 基于 JSON 文件的简易用户存储（适合单机/轻量部署）。
 */
export class UserStore {
    filePath;
    constructor(dataDir) {
        this.filePath = path.join(dataDir, "users.json");
    }
    /**
     * 是否需要初始化管理员（首次运行）。
     */
    async needsBootstrap() {
        const state = await this.readState();
        return state.users.length === 0;
    }
    /**
     * 初始化首个管理员账号（仅当当前无任何用户时允许）。
     */
    async bootstrapAdmin(username, password) {
        const state = await this.readState();
        if (state.users.length > 0) {
            throw new Error("ALREADY_BOOTSTRAPPED");
        }
        const now = new Date().toISOString();
        const admin = {
            id: crypto.randomUUID(),
            username,
            passwordHash: hashPassword(password),
            role: "admin",
            createdAt: now,
            updatedAt: now,
        };
        await this.writeState({ users: [admin] });
        return admin;
    }
    /**
     * 通过用户名密码进行鉴权。
     */
    async authenticate(username, password) {
        const state = await this.readState();
        const user = state.users.find((u) => u.username === username);
        if (!user)
            return null;
        if (!verifyPassword(password, user.passwordHash))
            return null;
        return user;
    }
    /**
     * 查询所有用户（不分页，供管理页使用；规模较大时可改为分页）。
     */
    async listUsers() {
        const state = await this.readState();
        return state.users.slice().sort((a, b) => a.username.localeCompare(b.username));
    }
    /**
     * 创建用户（admin 权限）。
     */
    async createUser(input) {
        const state = await this.readState();
        if (state.users.some((u) => u.username === input.username)) {
            throw new Error("USERNAME_EXISTS");
        }
        const now = new Date().toISOString();
        const user = {
            id: crypto.randomUUID(),
            username: input.username,
            passwordHash: hashPassword(input.password),
            role: input.role,
            createdAt: now,
            updatedAt: now,
        };
        state.users.push(user);
        await this.writeState(state);
        return user;
    }
    /**
     * 修改用户角色/密码（admin 权限）。
     */
    async updateUser(userId, patch) {
        const state = await this.readState();
        const user = state.users.find((u) => u.id === userId);
        if (!user)
            throw new Error("NOT_FOUND");
        if (patch.role)
            user.role = patch.role;
        if (patch.password)
            user.passwordHash = hashPassword(patch.password);
        user.updatedAt = new Date().toISOString();
        await this.writeState(state);
        return user;
    }
    /**
     * 删除用户（admin 权限）。
     */
    async deleteUser(userId) {
        const state = await this.readState();
        const nextUsers = state.users.filter((u) => u.id !== userId);
        if (nextUsers.length === state.users.length)
            throw new Error("NOT_FOUND");
        await this.writeState({ users: nextUsers });
    }
    async readState() {
        await ensureDir(path.dirname(this.filePath));
        return readJsonFile(this.filePath, { users: [] });
    }
    async writeState(state) {
        await ensureDir(path.dirname(this.filePath));
        await writeJsonFile(this.filePath, state);
    }
}
