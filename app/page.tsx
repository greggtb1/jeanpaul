import Header from "@/components/Header";
import Hero from "@/components/Hero";
import LogoBanner from "@/components/LogoBanner";
import Steps from "@/components/Steps";
import Testimonials from "@/components/Testimonials";
import Pricing from "@/components/Pricing";
import FinalCta from "@/components/FinalCta";
import Faq from "@/components/Faq";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <div className="bg-decor" aria-hidden="true" />
      <div className="page">
        <Header />
        <Hero />
      </div>
      <LogoBanner />
      <main>
        <Steps />
        <Testimonials />
        <Pricing />
        <FinalCta />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
