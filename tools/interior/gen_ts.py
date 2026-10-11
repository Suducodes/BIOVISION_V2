"""Step 5: write src/anatomy/heartInteriorData.ts from interior.json + flows.json."""
import json
I = json.load(open('interior.json')); Fl = json.load(open('flows.json'))
# Semilunar rings sized to the vessel lumen; AV rings a touch inside the band.
radius = {'tricuspid': 0.13, 'mitral': 0.12, 'aortic': 0.085, 'pulmonary': 0.085}
weights = {'venous_lpa': 1.0, 'venous_rpa': 0.45, 'arterial_right_pv': 0.25, 'arterial_desc': 1.0,
           'arterial_bct': 0.2, 'arterial_lcca': 0.15, 'arterial_lsa': 0.15}
v3 = lambda a: '[' + ', '.join(f'{x:.3f}' for x in a) + ']'
head = open('../../src/anatomy/heartInteriorData.ts', encoding='utf-8').read().split('export const CHAMBER_CENTROIDS')[0]
out = [head.rstrip() + '\n']
out.append('export const CHAMBER_CENTROIDS: Record<ChamberId, Vec3> = {')
out += [f"  {k}: {v3(v['centroid'])}," for k, v in I['chambers'].items()] + ['};\n']
out.append('export const SEPTUM_CENTROIDS: Record<SeptumId, Vec3> = {')
out += [f"  {k}: {v3(v['centroid'])}," for k, v in I['septa'].items()] + ['};\n']
out.append('export const VALVES: Record<ValveId, ValveData> = {')
out += [f"  {k}: {{ centre: {v3(v['centre'])}, normal: {v3(v['normal'])}, radius: {radius[k]}, leaflets: {2 if k == 'mitral' else 3} }},"
        for k, v in I['valves'].items()] + ['};\n']
out.append('export const FLOW_PATHS: FlowPath[] = [')
for k, v in Fl.items():
    pts = v['p'][::2] + ([v['p'][-1]] if (len(v['p']) - 1) % 2 else [])
    rr = v['r'][::2] + ([v['r'][-1]] if (len(v['r']) - 1) % 2 else [])
    out.append(f"  {{\n    id: '{k}',\n    kind: '{'venous' if k.startswith('venous') else 'arterial'}',\n    weight: {weights[k]},")
    out.append('    points: [' + ', '.join(v3(p) for p in pts) + '],')
    out.append('    radii: [' + ', '.join(f'{r:.3f}' for r in rr) + '],\n  },')
out.append('];')
open('../../src/anatomy/heartInteriorData.ts', 'w', encoding='utf-8').write('\n'.join(out) + '\n')
