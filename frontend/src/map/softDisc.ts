// A ScatterplotLayer draws hard-edged discs. This extension fades each disc to nothing at its rim so
// overlapping discs add up into a smooth glow instead of blotches. It is a fragment-shader hook only:
// geometry.uv is the position inside the disc (-1..1), so length(uv) is 0 at the centre, 1 at the rim.
import { LayerExtension } from '@deck.gl/core'

export class SoftDisc extends LayerExtension {
  static extensionName = 'SoftDisc'

  getShaders(): { inject: Record<string, string> } {
    return {
      inject: {
        'fs:DECKGL_FILTER_COLOR': `
          float softD = clamp(length(geometry.uv), 0.0, 1.0);
          float softK = 1.0 - softD;
          color.a *= softK * softK;
        `,
      },
    }
  }
}

/**
 * Pulls a ghost's small core toward warm white so individual ghosts read as bright points, and so dense
 * areas (where cores overlap) can climb toward white even though pure amber has almost no blue.
 * The mix is in linear light, like every colour we hand the map (see GHOST_RGB_LINEAR).
 */
export class WarmCore extends LayerExtension {
  static extensionName = 'WarmCore'

  getShaders(): { inject: Record<string, string> } {
    return {
      inject: {
        'fs:DECKGL_FILTER_COLOR': 'color.rgb = mix(color.rgb, vec3(1.0, 0.78, 0.42), 0.7);',
      },
    }
  }
}
