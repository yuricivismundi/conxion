"use client";

import TeacherBookingFlow from "@/components/teacher/TeacherBookingFlow";

type Props = {
  teacherUserId: string;
  teacherName: string;
};

export default function TeacherBookingCalendar({ teacherUserId, teacherName }: Props) {
  return (
    <TeacherBookingFlow
      teacherUserId={teacherUserId}
      teacherName={teacherName}
      variant="inline"
      initialServiceType="private_class"
    />
  );
}
