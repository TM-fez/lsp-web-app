import type { Request, Response, NextFunction } from 'express';
import type { UsersService } from './users.service.js';
import type { CreateUserDTO, ResetPasswordDTO, UpdateUserDTO, UsersRequestMeta } from './users.types.js';

export class UsersController {
  constructor(private readonly service: UsersService) {}

  private getRequestMeta(req: Request): UsersRequestMeta {
    // user id is carried in the JWT payload's `sub` claim (not `id`).
    return {
      userId: (req as any).user?.sub,
      ip: req.ip,
      requestId: (req as any).id,
    };
  }

  listUsers = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await this.service.listUsers();
      res.json({ data: users, total: users.length });
    } catch (err) {
      next(err);
    }
  };

  listRoles = async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const roles = await this.service.listRoles();
      res.json({ data: roles });
    } catch (err) {
      next(err);
    }
  };

  getUserById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await this.service.getUserById(req.params.id as string);
      res.json(user);
    } catch (err) {
      next(err);
    }
  };

  createUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await this.service.createUser(req.body as CreateUserDTO, this.getRequestMeta(req));
      res.status(201).json(user);
    } catch (err) {
      next(err);
    }
  };

  updateUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await this.service.updateUser(
        req.params.id as string,
        req.body as UpdateUserDTO,
        this.getRequestMeta(req)
      );
      res.json(user);
    } catch (err) {
      next(err);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await this.service.resetPassword(
        req.params.id as string,
        req.body as ResetPasswordDTO,
        this.getRequestMeta(req)
      );
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
