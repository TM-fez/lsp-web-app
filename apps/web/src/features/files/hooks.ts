import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listLibrary,
  uploadFile,
  classifyFile,
  deleteFile,
  type LibraryParams,
  type FilingCategory,
} from '@/lib/api/files';
import { errMessage } from '@/lib/api/errors';
import { toast } from '@/store/toast';

const FILES_KEY = ['files-library'] as const;

export function useFilesLibrary(params: LibraryParams) {
  return useQuery({
    queryKey: [...FILES_KEY, params],
    queryFn: () => listLibrary(params),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: FILES_KEY });
}

/**
 * Upload a standalone document and file it in one go. Two calls because the upload is a
 * streamed multipart body the server cannot reliably read form fields from; the category
 * is set once the file exists. If filing fails the file is kept (as Unfiled), never lost.
 */
export function useUploadDocument() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { file: File; category: FilingCategory; property_id: string | null }) => {
      const uploaded = await uploadFile(input.file);
      await classifyFile(uploaded.id, { category: input.category, property_id: input.property_id });
      return uploaded;
    },
    onSuccess: () => {
      toast.success('Document uploaded');
      invalidate();
    },
    onError: (e) => {
      toast.error(errMessage(e));
      invalidate();
    },
  });
}

export function useDeleteFile() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => deleteFile(id),
    onSuccess: () => {
      toast.success('File removed');
      invalidate();
    },
    onError: (e) => toast.error(errMessage(e)),
  });
}
