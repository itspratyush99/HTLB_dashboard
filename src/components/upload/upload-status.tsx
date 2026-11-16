import { Badge } from "@/components/ui/badge";

export function UploadStatus({ status }: { status: string }) {
  if (status === "completed") return <Badge color="#059669">Completed</Badge>;
  if (status === "failed") return <Badge color="#dc2626">Stopped part-way</Badge>;
  return <Badge color="#d97706">In progress / interrupted</Badge>;
}
