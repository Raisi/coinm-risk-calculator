import { AppHeader } from "@/components/AppHeader";
import { Calculator } from "@/components/Calculator";
import { BitunixSettings, Hints } from "@/components/Guidance";

export default function SwingPage() {
  return (
    <>
      <AppHeader active="swing" />
      <main className="page">
        <Calculator />
        <div className="guides">
          <Hints />
          <BitunixSettings />
        </div>
      </main>
    </>
  );
}
