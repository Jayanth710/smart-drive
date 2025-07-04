import SideBar from "@/components/SideBar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <SideBar>
        <div className="flex-1 p-4 overflow-y-auto">
          {children}
        </div>
      </SideBar>
    </div>
  );
}
