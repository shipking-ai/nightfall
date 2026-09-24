import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();
crons.interval('sweep empty seats', { seconds: 30 }, internal.rooms.sweep, {});
export default crons;
