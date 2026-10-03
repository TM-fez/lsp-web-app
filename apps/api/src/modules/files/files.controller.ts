import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { FilesService } from './files.service.js';
import { FileQuerySchema, LibraryQuerySchema, MAX_FILE_SIZE_BYTES, type ClassifyFileDTO } from './files.types.js';
import { accessiblePropertyIdsForUser } from '../../core/scope/activeProperty.js';
import type { LibraryViewer } from './files.library.js';

export class FilesController {
  public readonly uploadMiddleware: any;

  constructor(private readonly service: FilesService) {
    // Custom storage engine to pipe directly to our service without buffering
    const storage = {
      _handleFile: (req: any, file: any, cb: any) => {
        const meta = {
          userId: req.user?.sub,
          ip: req.ip,
          requestId: req.id,
        };
        // Note: Multer might not have parsed req.body completely yet if file is first in form-data
        const isPublic = req.body.is_public === 'true' || req.query.is_public === 'true';
        
        // Multer doesn't give precise file size in stream, using 0 as placeholder since service 
        // will ideally enforce it during streaming or via multer limits.
        const sizeBytes = Number(req.headers['content-length'] || 0);

        this.service.upload(
          file.stream,
          file.originalname,
          file.mimetype,
          sizeBytes,
          isPublic,
          meta
        ).then((res) => cb(null, res)).catch((err) => cb(err));
      },
      _removeFile: (req: any, file: any, cb: any) => {
        cb(null);
      }
    };

    const upload = multer({
      storage,
      limits: { fileSize: MAX_FILE_SIZE_BYTES }
    });

    this.uploadMiddleware = upload.single('file');
  }

  private getRequestMeta(req: Request) {
    return {
      // JWT payload puts the user id in `sub` (not `id`); using `.id` left
      // created_by NULL and 500'd every upload.
      userId: (req as any).user?.sub,
      ip: req.ip,
      requestId: (req as any).id,
    };
  }

  /** Who is looking, in the terms the library's visibility rules need. */
  private async viewer(req: Request): Promise<LibraryViewer> {
    const user = req.user!;
    return {
      userId: user.sub,
      canSeeGuestDocuments: user.permissions.includes('files.guest_documents.read'),
      isContractor: user.role === 'contractor',
      accessiblePropertyIds: await accessiblePropertyIdsForUser(user.sub, user.role),
    };
  }

  library = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = LibraryQuerySchema.parse(req.query);
      res.json(await this.service.library(await this.viewer(req), query));
    } catch (err) {
      next(err);
    }
  };

  classify = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const canManage = req.user!.permissions.includes('files.delete');
      const file = await this.service.classify(
        req.params.id as string,
        req.body as ClassifyFileDTO,
        await this.viewer(req),
        canManage,
        this.getRequestMeta(req)
      );
      res.json(file);
    } catch (err) {
      next(err);
    }
  };

  uploadFile = (req: Request, res: Response, _next: NextFunction) => {
    // The actual upload is handled by multer storage engine
    // If it succeeds, the result is in req.file
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    res.status(201).json(req.file);
  };

  listFiles = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = FileQuerySchema.parse(req.query);
      const meta = this.getRequestMeta(req);
      const isAdmin = ((req as any).user?.role ?? '') === 'admin';
      const result = await this.service.listFiles(query, meta, isAdmin);
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  getFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.service.getMetadata(req.params.id as string, await this.viewer(req));
      res.json(result);
    } catch (err) {
      next(err);
    }
  };

  downloadFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { stream, file } = await this.service.getDownloadStream(req.params.id as string, await this.viewer(req));
      res.setHeader('Content-Type', file.mime_type);
      res.setHeader('Content-Disposition', `inline; filename="${file.original_name}"`);
      stream.pipe(res);
    } catch (err) {
      next(err);
    }
  };

  deleteFile = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const meta = this.getRequestMeta(req);
      await this.service.delete(req.params.id as string, meta);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  };
}
