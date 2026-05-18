import SideBar from "@/components/SideBar";
import { QuickChatWidget } from "@/components/QuickChatWidget";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-[100dvh]">
      <SideBar>
        <div className="flex-1 p-4 overflow-y-auto">
          {children}
        </div>
      </SideBar>
      <QuickChatWidget />
    </div>
  );
}
