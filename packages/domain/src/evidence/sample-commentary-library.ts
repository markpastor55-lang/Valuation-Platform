import type { LocalDate } from '../core/dates.js';
import type { DataSource } from '../core/data-source.js';
import type { Provenance } from '../core/provenance.js';
import type { CommentaryModule } from './commentary-library.js';

/**
 * Demonstration content for the market commentary library. Current paragraphs are deliberately
 * qualitative (no figures) and are attributed to a demonstration research source; the 2019
 * paragraphs record well-documented events for the retrospective demo job. A firm replaces all
 * of this with its own approved commentary before live use. [REVIEW: API_STANDARDS]
 */

export const DEMO_RESEARCH_SOURCE: DataSource = {
  id: 'ds-demo-research',
  name: 'Market research desk (demonstration content)',
  provider: 'Example Valuers Pty Ltd',
  kind: 'market_commentary',
  licence: {
    basis: 'internal',
    permitsStorage: true,
    permitsReportReproduction: true,
    permitsBulkUse: true,
  },
  status: 'active',
};

export const PUBLIC_RELEASES_SOURCE: DataSource = {
  id: 'ds-public-releases',
  name: 'Public statements by governments and regulators',
  provider: 'Reserve Bank of Australia, APRA, Australian and state governments',
  kind: 'market_commentary',
  licence: {
    basis: 'open_licence',
    reference: 'Cited, not reproduced [REVIEW: DATA_LICENSING]',
    permitsStorage: true,
    permitsReportReproduction: true,
    permitsBulkUse: false,
  },
  status: 'active',
};

const CURRENT: LocalDate = '2026-08-31';
const MID_2019: LocalDate = '2019-06-30';

const source = (
  sourceRef: string,
  effectiveDate: LocalDate,
  from: DataSource = DEMO_RESEARCH_SOURCE,
): Provenance => ({
  origin: 'external_source',
  sourceId: from.id,
  sourceRef,
  retrievedAt: `${effectiveDate}T00:00:00Z`,
  effectiveDate,
  licenceBasis: from.licence.basis,
  verification: 'verified',
  verifiedBy: 'demo-standards-owner',
  verifiedAt: `${effectiveDate}T00:00:00Z`,
  capturedBy: 'demo-research',
  capturedAt: `${effectiveDate}T00:00:00Z`,
});

const REVIEW_2026 = source('Quarterly market review, August 2026 (demonstration content)', CURRENT);
const REVIEW_2019 = source('Quarterly market review, June 2019 (demonstration content)', MID_2019);

type Draft = Pick<CommentaryModule, 'moduleId' | 'level' | 'title' | 'text'> &
  Partial<
    Pick<
      CommentaryModule,
      'jurisdiction' | 'localities' | 'propertyTypes' | 'version' | 'asAtDate' | 'sources'
    >
  >;

const approved = (d: Draft): CommentaryModule => {
  const asAtDate = d.asAtDate ?? CURRENT;
  return {
    version: 1,
    sources: [asAtDate === MID_2019 ? REVIEW_2019 : REVIEW_2026],
    ...d,
    asAtDate,
    status: 'approved',
    authoredBy: 'demo-research',
    authoredAt: `${asAtDate}T00:00:00Z`,
    approvedBy: 'demo-standards-owner',
    approvedAt: `${asAtDate}T06:00:00Z`,
  };
};

const NATIONAL: readonly CommentaryModule[] = [
  approved({
    moduleId: 'au-overview',
    version: 1,
    asAtDate: MID_2019,
    level: 'national',
    title: 'Australian economy and property market',
    text: 'The Reserve Bank of Australia reduced the cash rate to 1.25 per cent in June 2019, its first change since August 2016, citing spare capacity in the labour market and low inflation. Credit conditions had tightened after the Banking Royal Commission and earlier APRA limits on investor and interest-only lending, and in May 2019 APRA proposed easing its guidance on loan serviceability. The re-election of the federal government in May 2019 removed uncertainty over proposed changes to negative gearing and the capital gains tax discount. After falls through 2018 and early 2019, conditions in the largest capital cities were showing early signs of stabilising.',
    sources: [
      REVIEW_2019,
      source('RBA monetary policy decision, 4 June 2019', '2019-06-04', PUBLIC_RELEASES_SOURCE),
      source(
        'APRA proposed changes to residential mortgage serviceability guidance, 21 May 2019',
        '2019-05-21',
        PUBLIC_RELEASES_SOURCE,
      ),
    ],
  }),
  approved({
    moduleId: 'au-overview',
    version: 2,
    level: 'national',
    title: 'Australian economy and property market',
    text: 'Australian property markets are shaped by interest rates, the availability of credit, population growth and the supply of new dwellings. The Reserve Bank of Australia reduced the cash rate during 2025; since then the outlook for rates has depended on the path of inflation, and borrowers remain sensitive to any change. Lenders continue to assess borrowers against a serviceability buffer, which limits how far buyers can stretch. Population growth, largely from net overseas migration, continues to support demand for housing and rental accommodation, while new dwelling construction remains below the level needed to meet the National Housing Accord target of 1.2 million well-located homes over the five years from July 2024. Higher construction costs, labour shortages and builder insolvencies have constrained supply, and market performance varies by city, price point and property type.',
    sources: [
      REVIEW_2026,
      source(
        'National Housing Accord, Australian Government',
        '2024-07-01',
        PUBLIC_RELEASES_SOURCE,
      ),
    ],
  }),
  approved({
    moduleId: 'au-houses',
    version: 1,
    asAtDate: MID_2019,
    level: 'national',
    title: 'Houses',
    propertyTypes: ['RESIDENTIAL'],
    text: 'Dwelling values in Sydney and Melbourne fell materially from their 2017 peaks, with the largest falls among higher-priced houses, while Hobart, Canberra and some regional markets continued to grow. Lower interest rates and easier credit were expected to support buyer demand, although listings remained low and buyers cautious at mid-2019.',
  }),
  approved({
    moduleId: 'au-houses',
    version: 2,
    level: 'national',
    title: 'Houses',
    propertyTypes: ['RESIDENTIAL'],
    text: 'Detached houses have generally outperformed units in recent years, reflecting buyer preference for land and space and the limited supply of established houses in well-located suburbs. New house-and-land supply on the urban fringe is constrained by servicing and construction costs. First home buyers have been supported by government programs, including the expansion of the Home Guarantee Scheme from October 2025, which adds to demand at the lower end of the market.',
    sources: [
      REVIEW_2026,
      source('Home Guarantee Scheme, Housing Australia', '2025-10-01', PUBLIC_RELEASES_SOURCE),
    ],
  }),
  approved({
    moduleId: 'au-units',
    version: 1,
    asAtDate: MID_2019,
    level: 'national',
    title: 'Apartments and units',
    propertyTypes: ['RESIDENTIAL_UNIT'],
    text: 'Unit markets were affected by a large volume of new apartment completions in Sydney, Melbourne and Brisbane, softer investor demand under tighter lending, and reports of serious building defects in new apartment towers, including the Opal Tower in December 2018 and Mascot Towers in June 2019. These weighed on buyer and lender confidence in off-the-plan and recently completed apartments.',
  }),
  approved({
    moduleId: 'au-units',
    version: 2,
    level: 'national',
    title: 'Apartments and units',
    propertyTypes: ['RESIDENTIAL_UNIT'],
    text: 'Apartments and units have generally recorded softer price growth than houses, but their relative affordability has drawn first home buyers and downsizers to well-located units. Construction of new apartments remains well below earlier peaks because high building costs and finance requirements make many projects unfeasible, limiting future supply. Low rental vacancy has pushed unit rents higher, supporting investor demand. Buyers and lenders remain sensitive to building quality, defect history and strata levies, and some lenders restrict lending on very small units.',
  }),
  approved({
    moduleId: 'au-office',
    level: 'national',
    title: 'Office',
    propertyTypes: ['COMMERCIAL_OFFICE'],
    text: 'Office markets continue to adjust to hybrid work. Tenant demand is concentrated in modern, well-located buildings with strong environmental ratings, while older secondary buildings face higher vacancy and larger leasing incentives. Higher interest rates from 2022 softened yields and reduced transaction volumes, and investors price assets with close attention to tenant covenant, lease expiry profile and capital expenditure.',
  }),
  approved({
    moduleId: 'au-retail',
    level: 'national',
    title: 'Retail',
    propertyTypes: ['COMMERCIAL_RETAIL'],
    text: 'Retail property follows household spending, which has been restrained by cost-of-living pressures. Neighbourhood centres anchored by supermarkets and non-discretionary retailers have generally performed better than centres relying on discretionary spending. Yields softened from 2022 as interest rates rose; well-leased convenience assets remain sought after by private investors and syndicates.',
  }),
  approved({
    moduleId: 'au-industrial',
    level: 'national',
    title: 'Industrial and logistics',
    propertyTypes: ['INDUSTRIAL'],
    text: 'Industrial and logistics property has benefited from growth in online retail, supply-chain changes and population growth. Vacancy has risen from the record lows of 2022 as new buildings were completed and rental growth has moderated, but well-located sites near major freight routes remain in demand. Zoned and serviced industrial land is scarce in most capital cities, supporting land values.',
  }),
  approved({
    moduleId: 'au-land',
    level: 'national',
    title: 'Land and development sites',
    propertyTypes: ['VACANT_LAND'],
    text: 'Demand for land depends on borrowing capacity and on the cost and timing of construction. Higher building costs and longer approval and servicing times have reduced the feasibility of some developments, while the shortage of serviced lots in growth areas supports prices for land that is ready to build on. Development sites are sensitive to zoning, infrastructure charges and finance terms.',
  }),
  approved({
    moduleId: 'au-specialised',
    level: 'national',
    title: 'Specialised and mixed-use property',
    propertyTypes: ['SPECIALISED_MIXED_USE'],
    text: 'Specialised and mixed-use properties trade in thin markets, so sales evidence is limited and value depends on the use, its licences and the depth of operator demand. The property’s alternative uses and the market for the business it supports should be considered alongside comparable sales.',
  }),
];

const STATE: readonly CommentaryModule[] = [
  approved({
    moduleId: 'nsw-overview',
    version: 1,
    asAtDate: MID_2019,
    level: 'state',
    jurisdiction: 'NSW',
    title: 'New South Wales',
    text: 'Sydney led the national downturn, with dwelling values falling from mid-2017 to mid-2019. Auction clearance rates improved in June 2019 after the federal election and the cash rate cut. Stamp duty exemptions for first home buyers on homes up to $650,000, introduced in July 2017, supported entry-level demand. Regional New South Wales was steadier than Sydney.',
    sources: [
      REVIEW_2019,
      source(
        'NSW First Home Buyers Assistance Scheme (from 1 July 2017)',
        '2017-07-01',
        PUBLIC_RELEASES_SOURCE,
      ),
    ],
  }),
  approved({
    moduleId: 'nsw-overview',
    version: 2,
    level: 'state',
    jurisdiction: 'NSW',
    title: 'New South Wales',
    text: 'New South Wales has the highest dwelling prices in Australia, centred on Sydney, which limits affordability and pushes demand towards units, outer suburbs and regional centres such as the Hunter, Illawarra and Central Coast. The state’s planning reforms, including the low and mid-rise housing policy introduced in 2025, aim to increase supply near transport and town centres. Stamp duty concessions for first home buyers apply below set price thresholds.',
  }),
  approved({
    moduleId: 'nsw-houses',
    level: 'state',
    jurisdiction: 'NSW',
    title: 'Houses in New South Wales',
    propertyTypes: ['RESIDENTIAL'],
    text: 'Houses in Sydney remain the most expensive in the country. Demand for family homes in established suburbs is supported by limited supply, while affordability pushes some buyers to outer suburbs and regional centres, where prices for houses have generally held firm.',
  }),
  approved({
    moduleId: 'nsw-units',
    level: 'state',
    jurisdiction: 'NSW',
    title: 'Units in New South Wales',
    propertyTypes: ['RESIDENTIAL_UNIT'],
    text: 'The NSW Building Commission, established in 2023, has increased oversight of new apartment construction, and defect and occupation certificate issues affect buyer confidence in some new buildings. Strata schemes must keep a capital works fund, and buyers and lenders consider levies, special levies and the scheme’s defect history.',
  }),
  approved({
    moduleId: 'vic-overview',
    level: 'state',
    jurisdiction: 'VIC',
    title: 'Victoria',
    text: 'Victoria’s housing market has been subdued compared with other states, with Melbourne values recovering more slowly. Land tax changes from 2024 increased holding costs for investors, and many have sold, adding to listings, while population growth and prices that are affordable relative to Sydney support owner-occupier demand. The state’s Housing Statement targets 800,000 new homes over ten years, with activity centres planned for higher density.',
    sources: [
      REVIEW_2026,
      source(
        'Victoria’s Housing Statement, Victorian Government (September 2023)',
        '2023-09-20',
        PUBLIC_RELEASES_SOURCE,
      ),
    ],
  }),
  approved({
    moduleId: 'vic-houses',
    level: 'state',
    jurisdiction: 'VIC',
    title: 'Houses in Victoria',
    propertyTypes: ['RESIDENTIAL'],
    text: 'Demand for houses is strongest for family homes in established middle-ring suburbs of Melbourne with good schools and transport. Estates in the growth areas compete on price, supported by ongoing land releases, and regional centres such as Geelong and Ballarat draw buyers seeking space.',
  }),
  approved({
    moduleId: 'vic-units',
    level: 'state',
    jurisdiction: 'VIC',
    title: 'Units in Victoria',
    propertyTypes: ['RESIDENTIAL_UNIT'],
    text: 'Melbourne has a large stock of investor-owned apartments, and higher land tax and changes to rental regulation have prompted some investors to sell, adding to supply in inner-city unit markets. Cladding rectification and defect history are relevant to many high-rise buildings, and lenders often ask about cladding status. Owner-occupiers favour smaller, older blocks with low levies.',
  }),
  approved({
    moduleId: 'qld-overview',
    level: 'state',
    jurisdiction: 'QLD',
    title: 'Queensland',
    text: 'Queensland has had strong population growth from interstate and overseas migration, supporting demand in Brisbane, the Gold Coast, the Sunshine Coast and regional centres. Prices have risen well above pre-2020 levels, reducing the affordability advantage the state once had. Infrastructure for the Brisbane 2032 Olympic and Paralympic Games and transport projects adds to construction demand, which competes with housing for labour and materials.',
  }),
  approved({
    moduleId: 'qld-houses',
    level: 'state',
    jurisdiction: 'QLD',
    title: 'Houses in Queensland',
    propertyTypes: ['RESIDENTIAL'],
    text: 'Detached houses in south-east Queensland remain in demand from local buyers and people moving from other states, with limited new supply in established suburbs. Insurance costs in flood- and storm-exposed areas are an increasing consideration for buyers.',
  }),
  approved({
    moduleId: 'wa-overview',
    level: 'state',
    jurisdiction: 'WA',
    title: 'Western Australia',
    text: 'Western Australia’s economy is supported by the resources sector. Perth has recorded some of the strongest price growth of the capital cities since 2020, from a lower base, with low listings and very low rental vacancy. Construction capacity is stretched, lengthening build times, and regional markets linked to mining activity can move quickly with commodity cycles.',
  }),
  approved({
    moduleId: 'wa-houses',
    level: 'state',
    jurisdiction: 'WA',
    title: 'Houses in Western Australia',
    propertyTypes: ['RESIDENTIAL'],
    text: 'Established houses in Perth have met strong competition, with limited listings and short selling periods. Affordability remains better than in the eastern capitals, which continues to attract interstate investors and buyers.',
  }),
  approved({
    moduleId: 'sa-overview',
    level: 'state',
    jurisdiction: 'SA',
    title: 'South Australia',
    text: 'Adelaide prices have risen strongly since 2020 on limited supply and relative affordability. Defence and shipbuilding programs, including the AUKUS submarine program, support employment in the north and west of Adelaide. Land supply in growth areas and infill development will shape future supply.',
  }),
  approved({
    moduleId: 'tas-overview',
    level: 'state',
    jurisdiction: 'TAS',
    title: 'Tasmania',
    text: 'Tasmania’s market, led by Hobart, rose strongly to 2022 and has since been more subdued as affordability limits demand. Population growth is slower than in the mainland states, and the market is sensitive to interstate migration and tourism.',
  }),
  approved({
    moduleId: 'act-overview',
    level: 'state',
    jurisdiction: 'ACT',
    title: 'Australian Capital Territory',
    text: 'The Australian Capital Territory’s market is underpinned by public sector employment and high incomes. The territory is phasing out stamp duty in favour of general rates, which affects holding costs, and a large pipeline of apartments in Canberra’s town centres has given buyers choice and moderated unit price growth.',
  }),
  approved({
    moduleId: 'nt-overview',
    level: 'state',
    jurisdiction: 'NT',
    title: 'Northern Territory',
    text: 'The Northern Territory is a small market centred on Darwin and influenced by defence, resources and government projects. Prices fell for several years after 2014 and have since recovered. Rental yields are comparatively high, and the market is sensitive to population change and to lenders’ policies for remote areas.',
  }),
];

const LOCAL: readonly CommentaryModule[] = [
  approved({
    moduleId: 'local-exampleton',
    level: 'local',
    jurisdiction: 'VIC',
    localities: ['Exampleton', 'Example City Council'],
    title: 'Exampleton (demonstration suburb)',
    text: 'Exampleton is an established inner suburb close to the city, with train and tram services, schools and the Main Street shopping strip. Well-presented houses have met steady competition and sold within a few weeks of listing, while properties needing renovation have taken longer and sold after price adjustments. Listing volumes are close to usual seasonal levels.',
  }),
  approved({
    moduleId: 'local-exampleton-units',
    level: 'local',
    jurisdiction: 'VIC',
    localities: ['Exampleton'],
    title: 'Units in Exampleton',
    propertyTypes: ['RESIDENTIAL_UNIT'],
    text: 'Exampleton has a sizeable stock of apartments, including several recent projects near the station. Resales in older, smaller blocks with low levies are favoured by owner-occupiers; units in larger towers compete with new stock and investor resales, and prices vary with outlook, car parking and levies.',
  }),
  approved({
    moduleId: 'local-mockbury',
    level: 'local',
    jurisdiction: 'VIC',
    localities: ['Mockbury', 'Mockbury City Council'],
    title: 'Mockbury (demonstration suburb)',
    text: 'Mockbury is a middle-ring suburb popular with families for its larger blocks, parks and schools. Houses on standard blocks sell to owner-occupiers, often after a short campaign, and older homes on wider frontages attract interest from builders for knock-down and rebuild. Unit and townhouse development is concentrated near the station.',
  }),
  approved({
    moduleId: 'local-sampleville',
    version: 1,
    asAtDate: MID_2019,
    level: 'local',
    jurisdiction: 'NSW',
    localities: ['Sampleville', 'City of Sampleville'],
    title: 'Sampleville (demonstration suburb)',
    text: 'Sampleville is an established suburb with good transport links. House prices eased through 2018 in line with the wider Sydney market, with longer selling periods and more vendor discounting. Activity improved in June 2019, with more buyers at open homes and better auction results for well-presented family homes.',
  }),
  approved({
    moduleId: 'local-sampleville',
    version: 2,
    level: 'local',
    jurisdiction: 'NSW',
    localities: ['Sampleville', 'City of Sampleville'],
    title: 'Sampleville (demonstration suburb)',
    text: 'Sampleville is an established suburb with good transport links. Family homes are in demand and sell to owner-occupiers after short campaigns, while apartments near the station appeal to first home buyers and investors. Few houses come to market, which supports prices, and homes needing work still sell readily to buyers planning to renovate.',
  }),
  approved({
    moduleId: 'local-demo-heights',
    level: 'local',
    jurisdiction: 'QLD',
    localities: ['Demo Heights', 'Demo City Council'],
    title: 'Demo Heights (demonstration suburb)',
    text: 'Demo Heights is a leafy suburb close to the city, popular with families and people moving from interstate. Character houses on larger blocks are keenly sought, and listings are below usual levels. Properties on low-lying land near the creek may be affected by flood mapping, which buyers and insurers consider.',
  }),
  approved({
    moduleId: 'local-testford',
    level: 'local',
    jurisdiction: 'WA',
    localities: ['Testford', 'City of Testford'],
    title: 'Testford (demonstration suburb)',
    text: 'Testford is an established suburb with good access to the freeway, rail and the local shopping centre. Houses sell quickly to owner-occupiers and investors, with few listings and limited new supply, and well-maintained homes often attract several offers. Older homes on larger blocks draw interest from small builders for subdivision where zoning allows.',
  }),
];

/** The demonstration library (approved), used by the preview and the API demo seed. */
export const SAMPLE_COMMENTARY_LIBRARY: readonly CommentaryModule[] = [
  ...NATIONAL,
  ...STATE,
  ...LOCAL,
];
