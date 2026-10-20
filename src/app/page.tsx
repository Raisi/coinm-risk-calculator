import { AppHeader } from "@/components/AppHeader";
import { Calculator } from "@/components/Calculator";
import { BitunixSettings, Hints } from "@/components/Guidance";

export default function CalculatorPage() {
  return (
    <main className="container page">
      <AppHeader />
      <Calculator />
      <div className="guides">
        <Hints />
        <BitunixSettings />
      </div>
    </main>
  );
}
