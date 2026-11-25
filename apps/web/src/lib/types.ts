// Shapes returned by the FastAPI backend. Money and quantities arrive as decimal strings.

export type Medicine = {
  id: string; medicine_code: string; generic_name: string; brand_name: string | null; strength: string | null;
  dosage_form: string | null; category: string | null; unit: string; reorder_level: string; is_active: boolean;
  on_hand?: string; low_stock?: boolean; nearest_expiry?: string | null;
};

export type Supplier = { id: string; name: string; contact_person: string | null; phone: string | null; address: string | null; is_active: boolean };

export type PurchaseItem = { medicine_id: string; medicine_name: string; strength: string | null; batch_number: string; expiry_date: string; quantity: string; unit_cost: string; selling_price: string; line_total: string };
export type Purchase = {
  id: string; purchase_number: string; supplier_id: string; supplier_name: string; supplier_invoice_no: string | null;
  purchase_date: string; total_amount: string; item_count: number; notes: string | null; created_at: string; items?: PurchaseItem[];
};

export type Batch = {
  batch_id: string; medicine_id: string; medicine_name: string; strength: string | null; batch_number: string; expiry_date: string;
  days_to_expiry: number; expired: boolean; on_hand: string; purchase_price: string; selling_price: string; stock_value: string;
};

export type Movement = {
  id: string; occurred_at: string; movement_type: string; medicine_name: string; strength: string | null; batch_number: string;
  quantity: string; reference_type: string | null; reference_id: string | null; performed_by: string;
};

export type SaleItem = { medicine_name: string; strength: string | null; batch_number: string; expiry_date: string; quantity: string; unit_price: string; line_total: string };
export type Sale = {
  id: string; sale_number: string; sold_at: string; patient_id: string | null; is_walk_in: boolean; customer_name: string | null;
  customer_phone: string | null; subtotal: string; discount_amount: string; total_amount: string; paid_amount: string; due_amount: string;
  payment_method: string | null; payment_status: string; invoice_id: string | null; sold_by: string | null; items?: SaleItem[];
};

export type Patient = {
  id: string; mrn: string; first_name: string; last_name: string | null; age: number | null; gender: string | null;
  blood_group: string | null; phone: string; email: string | null; address: string | null; created_at: string;
  login_username?: string | null; login_active?: boolean | null;
};

export type Invoice = {
  id: string; invoice_number: string; invoice_date: string; patient_id: string; subtotal: string; discount_amount: string;
  total_amount: string; paid_amount: string; balance: string; status: string; notes: string | null;
  patient_name?: string; patient_mrn?: string; patient_phone?: string;
  items?: { description: string; source_module: string; quantity: string; unit_price: string; line_total: string }[];
  payments?: { receipt_number: string; received_at: string; payment_method: string; allocated_amount: string }[];
};

export type Payment = {
  id: string; receipt_number: string; patient_id: string; amount: string; payment_method: string; reference_number: string | null;
  status: string; received_at: string; received_by: string | null; patient_name?: string; patient_mrn?: string;
};

export type Due = { patient_id: string; mrn: string; name: string; phone: string; outstanding: string; open_invoices: number; oldest_invoice_date: string };

export type Account = {
  patient: { id: string; mrn: string; name: string; phone: string };
  summary: { total_billed: string; total_paid: string; outstanding: string; open_invoices: number };
  invoices: Invoice[];
  payments: Payment[];
};

export const PAYMENT_METHODS = ["CASH", "CARD", "BANK_TRANSFER", "EASYPAISA", "JAZZCASH", "CHEQUE"] as const;
export const patientName = (p: { first_name: string; last_name: string | null }) => `${p.first_name} ${p.last_name ?? ""}`.trim();

export type StaffMember = {
  id: string; employee_code: string; full_name: string; designation: string;
  department: { id: string; name: string }; cnic: string | null; phone: string | null; address: string | null;
  joining_date: string | null; employment_status: string;
  user: { id: string; username: string; email: string | null; is_active: boolean; role: string | null;
          must_change_password: boolean; last_login_at: string | null } | null;
};
export type StaffOptions = {
  departments: { id: string; name: string }[]; roles: { name: string; label: string }[]; statuses: string[];
  can: { change_role: boolean; deactivate: boolean; reset_password: boolean; edit: boolean; create: boolean };
};

export type VisitMedicine = { id?: string; medicine_id: string | null; name: string; dosage: string | null; frequency: string | null; duration: string | null; instructions: string | null };
export type VisitAttachment = { id: string; kind: "SLIP" | "LAB_REPORT" | "OTHER"; file_name: string; content_type: string; size_bytes: number; uploaded_by: string | null; created_at: string };
export type Visit = {
  id: string; visit_number: number; visit_date: string; doctor_employee_id: string | null; doctor_name: string | null;
  complaint: string | null; analysis: string | null; notes: string | null; follow_up_date: string | null;
  created_by: string | null; updated_at: string | null; medicines: VisitMedicine[]; attachments: VisitAttachment[];
};
export type PatientCase = {
  id: string; case_number: string; title: string; status: "OPEN" | "FINALIZED"; opened_at: string; finalized_at: string | null;
  final_notes: string | null; visit_count: number; last_visit_date: string | null; last_doctor?: string | null;
  opened_by?: string | null; finalized_by?: string | null;
  patient: { id: string; mrn: string; name: string; phone: string }; visits?: Visit[];
};
