// The latitude and longitude of the centre of a sim cell (display data for the menu: the start marker and the camera flight).
export function latLonOfCell(cell: number, width: number, height: number): { lat: number; lon: number } {
  const x = cell % width;
  const y = (cell - x) / width;
  return { lat: ((height - 2 * y - 1) * 90) / height, lon: ((2 * x + 1 - width) * 180) / width };
}
