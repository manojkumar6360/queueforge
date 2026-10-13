import { PrismaClient, EventStatus, SeatStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding QueueForge database...');

  // Clean existing data for clean seed
  await prisma.seat.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.event.deleteMany({});
  await prisma.venue.deleteMany({});

  // 1. Create Venue
  const venue = await prisma.venue.create({
    data: {
      id: 'venue-wembley-arena',
      name: 'Wembley Arena',
      city: 'London',
      totalRows: 20,
      totalCols: 25,
    },
  });
  console.log(`✅ Venue created: ${venue.name} (${venue.totalRows}x${venue.totalCols} layout)`);

  // 2. Create Event (Coldplay 2026)
  const event = await prisma.event.create({
    data: {
      id: 'event-coldplay-2026',
      title: 'Coldplay: Music of the Spheres World Tour 2026',
      venueId: venue.id,
      eventDate: new Date('2026-11-20T19:30:00Z'),
      status: EventStatus.ON_SALE,
      maxTicketsPerUser: 4,
    },
  });
  console.log(`✅ Event created: ${event.title} (ID: ${event.id})`);

  // 3. Create 500 Seats (20 rows A-T, 25 seats per row)
  const rows = [
    'A', 'B', 'C', 'D', 'E', // Rows 1-5: VIP
    'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', // Rows 6-13: Floor
    'N', 'O', 'P', 'Q', 'R', 'S', 'T'  // Rows 14-20: Balcony
  ];

  const seatsData: Array<{
    id: string;
    eventId: string;
    section: string;
    row: string;
    number: number;
    priceCents: number;
    status: SeatStatus;
  }> = [];

  for (const row of rows) {
    let section = 'Balcony Standard';
    let priceCents = 5000; // $50

    if (['A', 'B', 'C', 'D', 'E'].includes(row)) {
      section = 'VIP Platinum';
      priceCents = 15000; // $150
    } else if (['F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'].includes(row)) {
      section = 'Floor Reserved';
      priceCents = 8500; // $85
    }

    for (let num = 1; num <= 25; num++) {
      seatsData.push({
        id: `${event.id}-${row}-${num}`,
        eventId: event.id,
        section,
        row,
        number: num,
        priceCents,
        status: SeatStatus.AVAILABLE,
      });
    }
  }

  // Batch insert seats
  await prisma.seat.createMany({
    data: seatsData,
  });

  console.log(`✅ Created ${seatsData.length} interactive seats across 3 tiers (VIP, Floor, Balcony).`);
  console.log('🎉 Database seeding complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
