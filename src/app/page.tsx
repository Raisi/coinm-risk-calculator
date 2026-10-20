import { AppHeader } from "@/components/AppHeader";
import { Calculator } from "@/components/Calculator";
import { BitunixSettings, Hints } from "@/components/Guidance";

export default function SwingPage() {
  return (
    <main className="container page">
      <AppHeader active="swing" />
      <Calculator />
      <div className="guides">
        <Hints />
        <BitunixSettings />
      </div>
    </main>
  );
}
