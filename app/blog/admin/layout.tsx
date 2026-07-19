import { notFound, redirect } from "next/navigation";
import { requireBlogAdmin } from "@/lib/blog-admin";

export default async function BlogAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const gate = await requireBlogAdmin();
  if (!gate.ok) {
    if (gate.status === 401) {
      redirect("/login?next=/blog/admin");
    }
    notFound();
  }
  return children;
}
