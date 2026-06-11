import Image from "next/image";

// invert: true = logo sombre à inverser en blanc ; false = déjà blanc/transparent ; tall: logo plus grand
const companies = [
  { name: "BlaBlaCar",     img: "/banner-blablacar.png", invert: false, tall: true },
  { name: "Doctolib",      img: "/banner-doctolib.png",  invert: false },
  { name: "leboncoin",     img: "/banner-leboncoin.png", invert: false, height: 31 },
  { name: "Alan",          img: "/banner-alan.png",      invert: false, tall: true },
  { name: "Qonto",         img: "/banner-qonto.png",     invert: true  },
  { name: "Malt",          img: "/banner-malt.png",      invert: false },
  { name: "Back Market",   img: "/banner-backmarket.png", invert: false, tall: true },
  { name: "Pennylane",     img: "/banner-pennylane.png", invert: false, tall: true },
  { name: "Payfit",        img: "/banner-payfit.png",    invert: false, tall: true },
];

const all = [...companies, ...companies];

export default function LogoBanner() {
  return (
    <div className="banner-wrap">
      <div className="banner-inner">
        <div className="banner-label">
          <span className="banner-label__line1">Candidaté avec JEAN PAUL</span>
          <span className="banner-label__line2">maintenant chez →</span>
        </div>

        <div className="banner-track-wrap">
          <div className="banner-track">
            {all.map((c, i) => (
              <span className="banner-logo" key={`${c.name}-${i}`}>
                {c.img ? (
                  <Image
                    src={c.img}
                    alt={c.name}
                    height={c.height ?? (c.tall ? 44 : 22)}
                    width={0}
                    sizes="200px"
                    style={c.height ? { height: c.height } : undefined}
                    className={`banner-logo__img${c.invert ? " banner-logo__img--invert" : ""}${c.tall ? " banner-logo__img--tall" : ""}`}
                  />
                ) : (
                  <>
                    <span className="banner-logo__pill" />
                    <span className="banner-logo__name">{c.name}</span>
                  </>
                )}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
