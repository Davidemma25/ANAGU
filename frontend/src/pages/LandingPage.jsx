import { Link } from 'react-router-dom';
import IsometricLandCitySvg from '../components/IsometricLandCitySvg.jsx';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#FDE878] text-[#1F2421] flex flex-col">
      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 pt-16 sm:pt-24 pb-0 text-center">
        <h1 className="font-editorial text-4xl sm:text-5xl md:text-[56px] font-bold leading-[1.1] tracking-tight text-[#1F2421] max-w-2xl mx-auto">
          Buy, verify, and register land with confidence.
        </h1>

        <p className="mt-5 text-sm sm:text-base text-[#2D312E] max-w-lg mx-auto leading-relaxed">
          Public portal for registering land parcels, verifying boundaries and ownership
          deeds before buying, and trading verified properties through Polygon escrow.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/marketplace"
            className="px-6 py-3 text-sm font-semibold bg-[#1F2421] text-white rounded-xs hover:bg-black transition-colors whitespace-nowrap"
          >
            Browse &amp; Buy Verified Land
          </Link>
          <Link
            to="/register"
            className="px-6 py-3 text-sm font-medium text-[#1F2421] border border-[#1F2421] rounded-xs hover:bg-[#1F2421]/5 transition-colors whitespace-nowrap"
          >
            Register Land to Sell
          </Link>
        </div>

        {/* Isometric city illustration flush to bottom of hero */}
        <div className="mt-10 sm:mt-14 w-full max-w-5xl mx-auto -mx-2 sm:mx-0">
          <IsometricLandCitySvg />
        </div>
      </section>
    </div>
  );
}
