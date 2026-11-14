import type { Meta, StoryObj } from '@storybook/react-vite';
import { DYA_BRAND } from '@dya/config';
import { BrandLogo } from '@dya/ui/components/brand-logo';
import { BrandMark } from '@dya/ui/components/brand-mark';
import { PrivacyIcon } from '@dya/ui/components/privacy-icon';
import { NavigationIcon } from '@dya/ui/components/navigation-icon';
import { CoinsIcon } from '@dya/ui/components/coins-icon';
import { InsightsIcon } from '@dya/ui/components/insights-icon';
import { bentoBands, bentoGrain, terminal } from './brand-assets';
import privacySvg from '../../../../packages/ui/src/brand/icons/privacy.svg?url';
import './bento.css';

function Pattern() {
  return <div className="identity-pattern" aria-hidden="true">{[0,1].map(row => <div key={row}><NavigationIcon icon="markets" active /><NavigationIcon icon="trade" active /><NavigationIcon icon="portfolio" active /><CoinsIcon /><InsightsIcon /><PrivacyIcon /></div>)}</div>;
}
function Construction({ shield = false }: { shield?: boolean }) {
  return <div className="identity-construction"><div className="identity-guides" aria-hidden="true"><i /><i /><i /></div>{shield ? <PrivacyIcon className="identity-constructed-icon" /> : <NavigationIcon icon="portfolio" active className="identity-constructed-icon" />}</div>;
}
function Bento() {
  return <main className="identity-page"><header><h1>Dya.trade — visual identity</h1><p>Shared logo, Plus Jakarta Sans and custom icons. Product imagery uses the actual Terminal screenshot.</p><a href={privacySvg} download="dya-privacy.svg">Download privacy icon SVG ↗</a></header>
    <div className="identity-bento">
      <section className="identity-foundations identity-tile" aria-label="Logo, icon pattern and shared colors"><div className="identity-mark"><BrandMark /></div><div className="identity-pattern-tile"><Pattern /></div><div className="identity-small-lockup"><BrandLogo name={DYA_BRAND.name} size={20} /></div><div className="identity-swatches">{['background','card','primary','foreground'].map(token => <span key={token} style={{ background:`var(--${token})` }} title={`Shared UI token: ${token}`} />)}</div><div className="identity-lockup-scale">{[26,20,14].map(size => <BrandLogo key={size} name={DYA_BRAND.name} size={size} />)}</div></section>
      <section className="identity-type identity-tile" aria-label="Plus Jakarta Sans typography specimen"><span>Aa</span></section>
      <section className="identity-privacy identity-tile" aria-label="Custom privacy shield construction"><Construction shield /></section>
      <section className="identity-center identity-tile" aria-label="Primary identity lockup"><BrandLogo name={DYA_BRAND.name} size={48} /><p>{DYA_BRAND.tagline}</p></section>
      <section className="identity-wallet identity-tile" aria-label="Portfolio icon construction"><Construction /></section>
      <section className="identity-product identity-tile" aria-label="Actual Terminal product detail"><img src={terminal} alt="Actual Dya.trade Terminal showing the NEAR market header and chart" /></section>
      <section className="identity-bands identity-tile" aria-label="Approved layered graphic"><img src={bentoBands} alt="Approved dark emerald layered bands" /></section>
      <section className="identity-trade identity-tile" aria-label="Custom Trade icon"><NavigationIcon icon="trade" active /></section>
      <section className="identity-grain identity-tile" aria-label="Grainy tonal graphic study"><img src={bentoGrain} alt="Generated emerald tonal field with fine grain and an asymmetric branching flow" /></section>
    </div>
  </main>;
}
const meta = { title:'Brand/Identity Bento', component:Bento, parameters:{ layout:'fullscreen', controls:{ disable:true } } } satisfies Meta<typeof Bento>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Board: Story = {};
