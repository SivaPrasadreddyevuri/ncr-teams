import { FilesTable } from '@/components/files/FilesTable';
import { files } from '@/lib/data';

export default function FilesPage() {
  return <FilesTable initialFiles={files} />;
}
