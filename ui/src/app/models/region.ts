// Shape of each entry in assets/data/endpoints.json (Google Cloud Run region endpoints)
export interface RegionModel {
  regionId: string
  displayName: string
  geography: string
  url: string
}
