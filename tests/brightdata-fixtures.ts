// Synthetic contract for tests. These enums, units and limits are NOT evidence
// of the authenticated Bright Data account schema and must never seed the UI.
export function nativeMetadata() {
  const output_fields = [
    "product_id",
    "url",
    "title",
    "final_price",
    "currency",
    "location",
    "listing_date",
  ].map((name) => ({ name }));
  const scrapers: Record<
    string,
    {
      input_schema: Record<string, unknown>[];
      output_fields: { name: string }[];
    }
  > = {
    discover_by_keyword: {
      input_schema: [
        { name: "keyword", type: "text", required: true },
        {
          name: "city",
          type: "text",
          required: true,
          description: "City name",
        },
        {
          name: "radius",
          type: "number",
          required: false,
          minimum: 1,
          maximum: 100,
          unit: "km",
        },
        {
          name: "date_listed",
          type: "text",
          required: false,
          enum: ["Last 24 hours", "Last 7 days"],
        },
      ],
      output_fields,
    },
    discover_by_url: {
      input_schema: [
        { name: "url", type: "url", required: true },
        {
          name: "country",
          type: "country",
          required: true,
          options: [{ value: "Brazil" }],
        },
      ],
      output_fields,
    },
    collect_by_url: {
      input_schema: [{ name: "url", type: "url", required: true }],
      output_fields,
    },
  };
  return [{ id: "gd_lvt9iwuh6fbcwmx1a", domain: "facebook.com", scrapers }];
}
export const nativeListing = {
  product_id: "112233",
  url: "https://www.facebook.com/marketplace/item/112233/?ref=search",
  title: "iPhone 15 128 GB",
  final_price: 2200,
  currency: "BRL",
  country_code: "BR",
  location: "Pinhais, Paraná, Brazil",
  listing_date: "2026-09-10T14:58:00Z",
};
