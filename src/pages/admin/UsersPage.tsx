import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { UserPlus, Loader2, Shield, User, Pencil, Trash2 } from "lucide-react";

interface UserProfile {
  id: string;
  nome: string;
  email: string;
  gc_user_id: string | null;
  auvo_user_id: string | null;
  role: string;
}

export default function UsersPage() {
  const { isAdmin, user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [editTarget, setEditTarget] = useState<UserProfile | null>(null);

  // Create form
  const [cNome, setCNome] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPassword, setCPassword] = useState("");
  const [cRole, setCRole] = useState("user");
  const [cGc, setCGc] = useState("");
  const [cAuvo, setCAuvo] = useState("");

  // Edit form
  const [eNome, setENome] = useState("");
  const [eRole, setERole] = useState("user");
  const [eGc, setEGc] = useState("");
  const [eAuvo, setEAuvo] = useState("");
  const [ePassword, setEPassword] = useState("");

  const fetchUsers = async () => {
    setLoading(true);
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id, nome, email, gc_user_id, auvo_user_id"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (profiles) {
      const rolesMap = new Map(roles?.map((r) => [r.user_id, r.role]) ?? []);
      setUsers(profiles.map((p) => ({ ...p, role: rolesMap.get(p.id) ?? "user" })));
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const resetCreate = () => {
    setCNome(""); setCEmail(""); setCPassword(""); setCRole("user"); setCGc(""); setCAuvo("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const res = await supabase.functions.invoke("admin-create-user", {
      body: { email: cEmail, password: cPassword, nome: cNome, role: cRole, gc_user_id: cGc || null, auvo_user_id: cAuvo || null },
    });
    setSaving(false);
    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Erro ao criar");
      return;
    }
    toast.success(`Usuário ${cNome} criado!`);
    setCreateOpen(false);
    resetCreate();
    fetchUsers();
  };

  const openEdit = (u: UserProfile) => {
    setEditTarget(u);
    setENome(u.nome);
    setERole(u.role);
    setEGc(u.gc_user_id || "");
    setEAuvo(u.auvo_user_id || "");
    setEPassword("");
    setEditOpen(true);
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    setSaving(true);
    const res = await supabase.functions.invoke("admin-manage-user", {
      body: {
        action: "update",
        user_id: editTarget.id,
        nome: eNome,
        role: eRole,
        gc_user_id: eGc || null,
        auvo_user_id: eAuvo || null,
        password: ePassword || undefined,
      },
    });
    setSaving(false);
    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Erro ao atualizar");
      return;
    }
    toast.success("Usuário atualizado!");
    setEditOpen(false);
    setEditTarget(null);
    fetchUsers();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    const res = await supabase.functions.invoke("admin-manage-user", {
      body: { action: "delete", user_id: deleteTarget.id },
    });
    setSaving(false);
    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Erro ao excluir");
      return;
    }
    toast.success("Usuário excluído!");
    setDeleteTarget(null);
    fetchUsers();
  };

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Acesso restrito a administradores.</p>
      </div>
    );
  }

  const renderForm = (
    mode: "create" | "edit",
    onSubmit: (e: React.FormEvent) => void,
    { nome, setNome, role, setRole, gc, setGc, auvo, setAuvo, password, setPassword, email, setEmail }: any
  ) => (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Nome</Label>
        <Input value={nome} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNome(e.target.value)} placeholder="Nome completo" required />
      </div>
      {mode === "create" && (
        <div className="space-y-2">
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} placeholder="email@exemplo.com" required />
        </div>
      )}
      {mode === "edit" && (
        <div className="space-y-2">
          <Label>Email</Label>
          <Input value={editTarget?.email || ""} disabled className="bg-muted" />
        </div>
      )}
      <div className="space-y-2">
        <Label>{mode === "create" ? "Senha" : "Nova Senha (opcional)"}</Label>
        <Input
          type="password"
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
          placeholder={mode === "create" ? "Mínimo 6 caracteres" : "Deixe vazio para manter"}
          {...(mode === "create" ? { required: true, minLength: 6 } : {})}
        />
      </div>
      <div className="space-y-2">
        <Label>Perfil</Label>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="user">Usuário</SelectItem>
            <SelectItem value="admin">Administrador</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>ID GestãoClick</Label>
          <Input value={gc} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGc(e.target.value)} placeholder="Opcional" />
        </div>
        <div className="space-y-2">
          <Label>ID Auvo</Label>
          <Input value={auvo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAuvo(e.target.value)} placeholder="Opcional" />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : mode === "create" ? <UserPlus className="h-4 w-4 mr-2" /> : <Pencil className="h-4 w-4 mr-2" />}
        {mode === "create" ? "Criar Usuário" : "Salvar Alterações"}
      </Button>
    </form>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Gerenciar Usuários</h1>
          <p className="text-sm text-muted-foreground">Crie e gerencie contas de acesso ao sistema</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><UserPlus className="h-4 w-4 mr-2" />Novo Usuário</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Criar Novo Usuário</DialogTitle></DialogHeader>
            {renderForm("create", handleCreate, {
              nome: cNome, setNome: setCNome, role: cRole, setRole: setCRole,
              gc: cGc, setGc: setCGc, auvo: cAuvo, setAuvo: setCAuvo,
              password: cPassword, setPassword: setCPassword, email: cEmail, setEmail: setCEmail,
            })}
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Usuário</DialogTitle></DialogHeader>
          {renderForm("edit", handleEdit, {
            nome: eNome, setNome: setENome, role: eRole, setRole: setERole,
            gc: eGc, setGc: setEGc, auvo: eAuvo, setAuvo: setEAuvo,
            password: ePassword, setPassword: setEPassword, email: "", setEmail: () => {},
          })}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{deleteTarget?.nome || deleteTarget?.email}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>ID GC</TableHead>
                <TableHead>ID Auvo</TableHead>
                <TableHead className="w-20 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Nenhum usuário cadastrado
                  </TableCell>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.nome || "—"}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <Badge variant={u.role === "admin" ? "default" : "secondary"} className="gap-1">
                        {u.role === "admin" ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
                        {u.role === "admin" ? "Admin" : "Usuário"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.gc_user_id || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.auvo_user_id || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(u)}
                          disabled={u.id === currentUser?.id}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
