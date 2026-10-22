import type * as React from 'react';

/** Button with the arrow at the end: primary (Red Fill, one per view), secondary (outlined) or text (link red). */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Verb-first label, two to three words: "Start collaboration". */
  children: React.ReactNode;
  /** "primary" (default): Red Fill, white label, soft red shadow. "secondary": ground fill, line-strong border. "text": link-red label only. */
  variant?: 'primary' | 'secondary' | 'text';
  /** Render as a link to this URL instead of a button. */
  href?: string;
  /** Show the trailing arrow (→). Default true. */
  arrow?: boolean;
}
export declare function Button(props: ButtonProps): React.ReactElement;

/** Eyebrow pill above a headline: mono caps, red dot, hairline border. */
export interface EyebrowProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** One to three words; shown in capitals: "Case study". */
  children: React.ReactNode;
  /** Show the red dot. Default true. */
  dot?: boolean;
}
export declare function Eyebrow(props: EyebrowProps): React.ReactElement;

/** The one red gradient word in a headline. */
export interface EmphasisProps extends React.HTMLAttributes<HTMLElement> {
  /** The single word that carries the idea. */
  children: React.ReactNode;
}
export declare function Emphasis(props: EmphasisProps): React.ReactElement;

/** Short red dash. */
export interface TickProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Width in px, clamped to 12–20. Default 16. */
  width?: number;
}
export declare function Tick(props: TickProps): React.ReactElement;

/** A row of numbers in equal cells, each with a red tick on the bar's top edge. */
export interface StatBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Real, approved numbers only: [{ value: "6", label: "Systems in production" }]. */
  stats: Array<{ value: React.ReactNode; label: React.ReactNode }>;
}
export declare function StatBar(props: StatBarProps): React.ReactElement;

/** Card or panel on the current ground: surface, hairline border, 10px corners. */
export interface CardProps extends React.HTMLAttributes<HTMLElement> {
  /** Element to render. Default "div". */
  as?: keyof JSX.IntrinsicElements;
  children?: React.ReactNode;
}
export declare function Card(props: CardProps): React.ReactElement;

/** Regular dot grid filling its positioned parent. */
export interface DotGridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Use the 30px pitch for images that platforms shrink. Default false (22px). */
  wide?: boolean;
  /** Presentation scale for 1920 × 1080 slides and big screens: grid-pitch-slide (40px), grid-dot-radius-slide (2.5px), grid-dot-slide dots. Default false. */
  slide?: boolean;
}
export declare function DotGrid(props: DotGridProps): React.ReactElement;

/** Red glow from the top-right corner of its positioned parent. */
export interface GlowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Add the second, weaker glow at the bottom-left. Default false. */
  second?: boolean;
}
export declare function Glow(props: GlowProps): React.ReactElement;

declare global {
  interface Window {
    BigMatrix: {
      Button: typeof Button; Eyebrow: typeof Eyebrow; Emphasis: typeof Emphasis; Tick: typeof Tick;
      StatBar: typeof StatBar; Card: typeof Card; DotGrid: typeof DotGrid; Glow: typeof Glow;
    };
  }
}
