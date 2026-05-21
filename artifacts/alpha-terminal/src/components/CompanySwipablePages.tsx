import { CompanyResearchHub, type CompanyResearchHubProps } from "@/components/CompanyResearchHub";

type Props = Pick<CompanyResearchHubProps, "candles" | "companyPage" | "onCompanyPageChange" | "sectionTabsInHeader" | "companyTabsId">;

export function CompanySwipablePages({
  candles,
  companyPage,
  onCompanyPageChange,
  sectionTabsInHeader = false,
  companyTabsId,
}: Props) {
  return (
    <CompanyResearchHub
      candles={candles}
      companyPage={companyPage}
      onCompanyPageChange={onCompanyPageChange}
      sectionTabsInHeader={sectionTabsInHeader}
      companyTabsId={companyTabsId}
    />
  );
}
