import { getCrmSnapshot } from "@/server/crm-store";

import { CrmDashboard } from "./_components/crm-dashboard";

export default async function Page() {
  const initialState = await getCrmSnapshot();
  return <CrmDashboard initialState={initialState} />;
}
