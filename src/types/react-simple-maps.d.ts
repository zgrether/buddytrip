declare module "react-simple-maps" {
  import type { ComponentType, CSSProperties, ReactNode } from "react";

  interface GeographyStyle {
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    outline?: string;
  }

  interface GeographyStyleProp {
    default?: GeographyStyle;
    hover?: GeographyStyle;
    pressed?: GeographyStyle;
  }

  interface GeographyProps {
    key?: string;
    geography: unknown;
    style?: GeographyStyleProp;
    [key: string]: unknown;
  }

  interface GeographiesRenderProps {
    geographies: Array<{ rsmKey: string; [key: string]: unknown }>;
  }

  interface GeographiesProps {
    geography: string | object;
    children: (props: GeographiesRenderProps) => ReactNode;
  }

  interface ComposableMapProps {
    projection?: string;
    style?: CSSProperties;
    width?: number;
    height?: number;
    children?: ReactNode;
    [key: string]: unknown;
  }

  interface MarkerProps {
    coordinates: [number, number];
    children?: ReactNode;
    [key: string]: unknown;
  }

  export const ComposableMap: ComponentType<ComposableMapProps>;
  export const Geographies: ComponentType<GeographiesProps>;
  export const Geography: ComponentType<GeographyProps>;
  export const Marker: ComponentType<MarkerProps>;
  export const ZoomableGroup: ComponentType<{ children?: ReactNode; [key: string]: unknown }>;
  export const Sphere: ComponentType<{ [key: string]: unknown }>;
  export const Graticule: ComponentType<{ [key: string]: unknown }>;
}
