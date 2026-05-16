import { VantaBackground } from "@/components/Home/VantaBackground";
import { HomeNavbar } from "@/components/Home/HomeNavbar";
import { PromptBox } from "@/components/Home/PromptBox";

export const metadata = {
  title: "DesignDB — Turn Ideas into Database Schemas",
  description: "Describe your system in plain English. DesignDB generates normalized 3NF schemas, ER diagrams, and SQL instantly.",
};

export default function HomePage() {
  return (
    <main className="relative w-full min-h-screen flex flex-col overflow-hidden">
      {/* Vanta animated fog */}
      <VantaBackground />

      {/* Subtle radial vignette on top of vanta */}
      <div
        className="fixed inset-0 -z-[5] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 40%, transparent 0%, rgba(0,10,20,0.55) 100%)",
        }}
      />

      {/* Navbar */}
      <HomeNavbar />

      {/* Hero content */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 pt-24 pb-16 gap-10">

        {/* Heading */}
        <div className="text-center flex flex-col gap-4 max-w-3xl">
          <h1
            className="text-6xl md:text-7xl text-white tracking-tight leading-[1.05]"
            style={{ fontFamily: "Vagnola, sans-serif" }}
          >
            Design
            <span
              className="ml-4"
              style={{
                background: "linear-gradient(135deg, #4a90d9 0%, #1e549f 50%, #7eb8f7 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              DB
            </span>
          </h1>
          <p className="text-base md:text-lg text-white/40 leading-relaxed max-w-xl mx-auto" style={{ fontFamily: "Vagnola, sans-serif" }}>
            Describe your system in plain English.<br />
            Get a normalized schema, ER diagram, and SQL — instantly.
          </p>
        </div>

        {/* Prompt box */}
        <PromptBox />


      </section>
    </main>
  );
}
