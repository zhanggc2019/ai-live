export interface AppUpdate {
  currentVersion: string
  latestVersion: string
  releaseNote?: string
  downloadURL: string
  canInstallInApp: boolean
}
