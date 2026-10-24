// The 15 departments of the original prototype (fee in rupees, dailyCap = tokens per day).
export const DEPARTMENTS = [
  ['General Medicine', 'GM', '101', 'Available', '9:00 AM - 1:00 PM', 10, 40],
  ['Cardiology', 'CD', '204', 'Available', '9:00 AM - 1:00 PM', 20, 50],
  ['Neurology', 'NE', '207', 'Busy', '10:00 AM - 2:00 PM', 20, 60],
  ['Orthopedics', 'OR', '112', 'Available', '10:00 AM - 2:00 PM', 15, 70],
  ['Pediatrics', 'PE', '105', 'Busy', '9:00 AM - 2:00 PM', 10, 40],
  ['Dermatology', 'DE', '118', 'Busy', '10:00 AM - 3:00 PM', 15, 50],
  ['ENT', 'EN', '121', 'Available', '9:00 AM - 1:00 PM', 15, 60],
  ['Gynecology', 'GY', '130', 'Available', '9:00 AM - 2:00 PM', 15, 70],
  ['Ophthalmology', 'OP', '124', 'Available', '10:00 AM - 2:00 PM', 15, 40],
  ['Dental', 'DN', '128', 'Busy', '9:00 AM - 1:00 PM', 15, 50],
  ['Emergency', 'EM', 'G-01', 'Available', '24 hours', 0, 20],
  ['Radiology', 'RA', '010', 'Available', '9:00 AM - 4:00 PM', 50, 70],
  ['Pathology', 'PA', '012', 'Available', '8:00 AM - 2:00 PM', 30, 40],
  ['Surgery', 'SU', '301', 'Busy', '10:00 AM - 2:00 PM', 20, 50],
  ['Physiotherapy', 'PH', '015', 'Available', '9:00 AM - 3:00 PM', 20, 60],
].map(([name, code, room, status, timing, fee, dailyCap]) => ({ name, code, room, status, timing, fee, dailyCap }));
