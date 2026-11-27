import { RolePage } from "@/components/candidates/role-page";

export const metadata = { title: "All" };

/** ZBM and HOS together: same search, filters, tags, export and bulk actions as the role tabs. */
export default function AllPage() {
  return <RolePage role="ALL" />;
}
