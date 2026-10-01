export type Task = {
  id: string;
  url: string;
  title: string;
  status: string;
  priority: string;
  type: string;
  area: string;
  course: string;
  courseCode?: string;
  estimatedHours?: number;
  assessment?: string;
  nextAction: string;
  dueDate: string | null;
  createdAt: string;
  completed: boolean;
};

export type TaskOptions = {
  types: string[];
  statuses: string[];
  priorities: string[];
  areas: string[];
  courses: string[];
  assessments: string[];
};

export type TasksResponse = {
  tasks: Task[];
  configured: boolean;
  options?: TaskOptions;
  error?: string;
};
