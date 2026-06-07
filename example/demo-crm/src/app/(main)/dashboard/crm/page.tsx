import { CrmDashboard } from "./_components/crm-dashboard";
import { getCrmSnapshot } from "@/server/crm-store";

export default async function Page() {
  const initialState = await getCrmSnapshot();

  return (
    <CrmDashboard initialState={initialState} />
  );
}
