export type DataSource = 'live' | 'stale-memory' | 'repository-fallback';

export type ApiSuccess<T> = {
  ok: true;
  data: T;
  source: DataSource;
  fetchedAt: string;
  stale?: boolean;
};

export type ApiFailure<T = never> = {
  ok: false;
  data?: T;
  error: string;
  fetchedAt: string;
};

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure<T>;

export type TleRecord = {
  name: string;
  line1: string;
  line2: string;
  noradId: string;
};

export type Launch = {
  id: string;
  name: string;
  mission: string;
  provider: string;
  rocket: string;
  padName: string;
  locationName: string;
  net: string;
  status: string;
  webcastUrl: string | null;
  imageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type Astronaut = {
  name: string;
  craft: string;
};

export type AstrosPayload = {
  count: number;
  people: Astronaut[];
};

export type Apod = {
  date: string;
  title: string;
  explanation: string;
  mediaType: 'image' | 'video';
  url: string;
  hdUrl: string | null;
  copyright: string | null;
};

export type ObserverLocation = {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  altitudeKm?: number;
};
