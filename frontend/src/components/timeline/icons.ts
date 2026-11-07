import {
  Ban, Binoculars, Bus, Camera, Database, Drone, Eye, Footprints, Heart, MapPin, Search, StickyNote, Users, UserRoundPen,
  type LucideIcon,
} from 'lucide-react'
import type { EvidenceKind, EvidenceSource } from '@/types'

/** One icon per evidence source (roadmap step 19). */
export const SOURCE_ICON: Record<EvidenceSource, LucideIcon> = {
  officer: UserRoundPen,
  family: Users,
  witness: Eye,
  drone_ai: Drone,
  ground_team: Footprints,
  transit: Bus,
  camera: Camera,
  registry: Database,
}

/** One icon per evidence kind: used on map pins. */
export const KIND_ICON: Record<EvidenceKind, LucideIcon> = {
  last_seen: MapPin,
  sighting: Eye,
  clue: Search,
  searched_area: Binoculars,
  favourite_place: Heart,
  constraint: Ban,
  note: StickyNote,
}
